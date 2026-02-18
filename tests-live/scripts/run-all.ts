/**
 * Run All — Sequential E2E Test Suite Runner
 *
 * Executes every script in order, stopping on critical failures.
 * Produces a final summary of pass/fail and error log location.
 *
 * Usage:
 *   npx ts-node scripts/run-all.ts
 */

import { logHeader, logPass, logInfo, logSummary, clearLog } from '../lib/logger';

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

interface ScriptEntry {
  name: string;
  module: string;
}

const SCRIPTS: ScriptEntry[] = [
  { name: '00a — Cleanup Previous Runs', module: './00a-cleanup-previous-runs' },
  { name: '00 — Register Organization', module: './00-register-organization' },
  { name: '01 — Create Members',        module: './01-create-members' },
  { name: '02 — Login Admin',           module: './02-login-admin' },
  { name: '03 — Create Base eCRFs',     module: './03-create-base-ecrfs' },
  { name: '04 — Fork for Validation',   module: './04-fork-ecrfs-validation' },
  { name: '05 — Fork for Workflow',     module: './05-fork-ecrfs-workflow' },
  { name: '06 — Create Study',          module: './06-create-study' },
  { name: '07 — Validation Rules',      module: './07-create-validation-rules' },
  { name: '08 — Setup Workflows',       module: './08-setup-workflows' },
  { name: '09 — Create Patient',        module: './09-create-patient' },
  { name: '10 — Fill Forms & Test',     module: './10-fill-forms-and-test' },
  { name: '11 — Branching eCRF Test',   module: './11-branching-ecrf-test' },
  { name: '12 — Patient Visits & Forms', module: './12-patient-visits-forms' },
];

async function main(): Promise<void> {
  console.log('');
  console.log(`${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║        EDC LIVE SERVER — END-TO-END TEST SUITE            ║${RESET}`);
  console.log(`${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // Clear previous error log
  clearLog();
  logInfo(`Started at ${new Date().toISOString()}`);
  logInfo(`Errors will be logged to: tests-live/logs/test-errors.json`);
  logInfo(`State will be persisted to: tests-live/state/state.json`);

  const results: { name: string; ok: boolean; duration: number }[] = [];
  let allPassed = true;

  for (const script of SCRIPTS) {
    const start = Date.now();

    try {
      const mod = require(script.module);
      const ok: boolean = await mod.run();
      const duration = Date.now() - start;

      results.push({ name: script.name, ok, duration });
      if (!ok) allPassed = false;
    } catch (err: any) {
      const duration = Date.now() - start;
      console.log(`  ${RED}[CRASH]${RESET} ${script.name}: ${err.message}`);
      results.push({ name: script.name, ok: false, duration });
      allPassed = false;
    }
  }

  // ── Final Summary ───────────────────────────────────────────────────────

  console.log('');
  console.log(`${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║                    TEST RESULTS SUMMARY                   ║${RESET}`);
  console.log(`${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  for (const r of results) {
    const icon = r.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const dur = `${(r.duration / 1000).toFixed(1)}s`;
    console.log(`  [${icon}] ${r.name.padEnd(35)} ${dur}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const totalTime = results.reduce((s, r) => s + r.duration, 0);

  console.log('');
  console.log(`  ${BOLD}Total: ${passed} passed, ${failed} failed${RESET} in ${(totalTime / 1000).toFixed(1)}s`);

  logSummary();

  console.log('');
  logInfo(`Finished at ${new Date().toISOString()}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
