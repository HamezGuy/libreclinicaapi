import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'test-errors.json');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export interface LogEntry {
  timestamp: string;
  script: string;
  step: string;
  endpoint: string;
  status: number | string;
  error: string;
  requestBody?: any;
  responseBody?: any;
}

function writeEntry(entry: LogEntry): void {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

export function logPass(script: string, step: string, detail?: string): void {
  const msg = detail ? `${step} — ${detail}` : step;
  console.log(`  ${GREEN}[PASS]${RESET} ${msg}`);
}

export function logFail(
  script: string,
  step: string,
  endpoint: string,
  status: number | string,
  error: string,
  requestBody?: any,
  responseBody?: any,
): void {
  console.log(`  ${RED}[FAIL]${RESET} ${step}`);
  console.log(`        ${DIM}${endpoint} -> ${status}: ${error}${RESET}`);

  writeEntry({
    timestamp: new Date().toISOString(),
    script,
    step,
    endpoint,
    status,
    error,
    requestBody,
    responseBody,
  });
}

export function logWarn(script: string, step: string, message: string): void {
  console.log(`  ${YELLOW}[WARN]${RESET} ${step} — ${message}`);
}

export function logInfo(message: string): void {
  console.log(`  ${CYAN}[INFO]${RESET} ${message}`);
}

export function logHeader(scriptName: string): void {
  console.log('');
  console.log(`${BOLD}========================================${RESET}`);
  console.log(`${BOLD}  ${scriptName}${RESET}`);
  console.log(`${BOLD}========================================${RESET}`);
}

export function logSummary(): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`\n${GREEN}No errors logged.${RESET}`);
    return;
  }
  const content = fs.readFileSync(LOG_FILE, 'utf-8').trim();
  if (!content) {
    console.log(`\n${GREEN}No errors logged.${RESET}`);
    return;
  }
  const lines = content.split('\n').filter(Boolean);
  console.log(`\n${BOLD}Error Summary: ${RED}${lines.length} error(s)${RESET} logged to:`);
  console.log(`  ${DIM}${LOG_FILE}${RESET}`);
}

export function clearLog(): void {
  if (fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
  }
}
