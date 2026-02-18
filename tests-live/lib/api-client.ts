import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { CONFIG } from './config';
import { loadState, updateState } from './state';
import { logFail, logInfo } from './logger';

let clientInstance: AxiosInstance | null = null;
let refreshInFlight = false;

export function getClient(): AxiosInstance {
  if (clientInstance) return clientInstance;

  clientInstance = axios.create({
    baseURL: CONFIG.BASE_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Attach auth token from state — skip if the caller explicitly set an empty
  // Authorization header (noAuth requests like login/register)
  clientInstance.interceptors.request.use((cfg) => {
    const existingAuth = cfg.headers?.['Authorization'];
    if (existingAuth === '' || existingAuth === undefined && !cfg.headers?.Authorization) {
      // noAuth: caller set Authorization to '' — don't overwrite
      if (existingAuth === '') return cfg;
    }
    const state = loadState();
    if (state.accessToken && cfg.headers) {
      cfg.headers['Authorization'] = `Bearer ${state.accessToken}`;
    }
    return cfg;
  });

  return clientInstance;
}

/**
 * Refresh the auth token by logging in again.
 */
export async function refreshAuth(): Promise<boolean> {
  if (refreshInFlight) return false;
  refreshInFlight = true;

  try {
    const state = loadState();
    if (!state.adminUsername) return false;

    const client = getClient();
    const res = await client.request({
      method: 'POST',
      url: '/auth/login',
      data: {
        username: state.adminUsername,
        password: CONFIG.ADMIN_PASSWORD,
      },
      headers: { Authorization: '' },
    });

    if (res.data?.accessToken) {
      updateState({
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
      });
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Convenience wrapper that logs failures automatically.
 * Auto-retries once on 401 (expired token) by refreshing auth.
 */
export async function apiCall<T = any>(opts: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: any;
  script: string;
  step: string;
  noAuth?: boolean;
  params?: Record<string, any>;
  /** If true, suppress logging on failure (for expected failures) */
  quiet?: boolean;
}): Promise<{ ok: boolean; status: number; data: T; raw: AxiosResponse<T> | null }> {
  const client = getClient();

  const makeConfig = (): AxiosRequestConfig => {
    const cfg: AxiosRequestConfig = {
      method: opts.method,
      url: opts.url,
      data: opts.data,
      params: opts.params,
    };
    if (opts.noAuth) {
      cfg.headers = { Authorization: '' };
    }
    return cfg;
  };

  try {
    const res = await client.request<T>(makeConfig());
    return { ok: true, status: res.status, data: res.data, raw: res };
  } catch (err: any) {
    const status = err.response?.status ?? 0;

    // Auto-refresh on 401 and retry once
    if (status === 401 && !opts.noAuth && !refreshInFlight) {
      logInfo(`Token expired — refreshing auth and retrying ${opts.method} ${opts.url}...`);
      const refreshed = await refreshAuth();
      if (refreshed) {
        try {
          const res2 = await client.request<T>(makeConfig());
          return { ok: true, status: res2.status, data: res2.data, raw: res2 };
        } catch (err2: any) {
          // Fall through to error logging
          const status2 = err2.response?.status ?? 0;
          const resBody2 = err2.response?.data ?? err2.message;
          const errorMsg2 = typeof resBody2 === 'object'
            ? resBody2.message || JSON.stringify(resBody2) : String(resBody2);

          if (!opts.quiet) {
            logFail(opts.script, opts.step, `${opts.method} ${opts.url}`, status2, errorMsg2, opts.data, resBody2);
          }
          return { ok: false, status: status2, data: resBody2 as T, raw: err2.response ?? null };
        }
      }
    }

    const resBody = err.response?.data ?? err.message;
    const errorMsg = typeof resBody === 'object'
      ? resBody.message || JSON.stringify(resBody) : String(resBody);

    if (!opts.quiet) {
      logFail(opts.script, opts.step, `${opts.method} ${opts.url}`, status, errorMsg, opts.data, resBody);
    }

    return { ok: false, status, data: resBody as T, raw: err.response ?? null };
  }
}
