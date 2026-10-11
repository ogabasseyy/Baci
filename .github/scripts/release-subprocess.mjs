import { spawnSync } from 'node:child_process';

// Bounded child execution for the release entry point. Split from
// release-production.mjs to keep both files under the 300-line
// boundary. Timeouts tag indeterminateDispatch: a timed-out API call
// may have landed, so the caller must hold the release lock for
// reconcile-before-removal.
export const API_COMMAND_TIMEOUT_MS = 60000;

function run(binary, args, cwd, capture, timeoutMs) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  if (result.error || result.status !== 0) {
    // Keep reconciliation context: which call failed, how (including
    // the kill signal — stderr stays inherited for live diagnostics,
    // so the signal is the post-mortem channel), and the first bytes
    // of whatever it printed before dying.
    const output = typeof result.stdout === 'string' ? result.stdout.trim().slice(0, 500) : '';
    const cause = result.error ? ` (${result.error.message})` : '';
    const signal = result.signal ? ` signal ${result.signal}` : '';
    const error = new Error(`${binary} ${args.join(' ')} failed with status ${result.status}${signal}${cause}${output ? `: ${output}` : ''}; inspect preceding diagnostics`);
    error.status = result.status;
    error.signal = result.signal;
    // A timeout means unknown remote state: the API call may have
    // landed. Always hold the lock for reconcile-before-removal,
    // even pre-dispatch (where dispatch provably never ran, so the
    // operator just confirms and removes).
    if (result.error && /time.?out/i.test(result.error.message)) {
      error.indeterminateDispatch = true;
    }
    throw error;
  }
  return capture ? result.stdout.trim() : '';
}

// deploy.sh exits 42 only when the live worker tree may be changed
// but unrecorded (rollback failed, or the rollback landed with
// unrecorded readers and a stuck barrier): the coordinator must hold
// the release lock for reconciliation instead of auto-releasing it
// for a clean retry.
export const WORKER_UNRECONCILED_EXIT = 42;

export function runWorkerDeploy(invoke) {
  try {
    return invoke();
  } catch (error) {
    // A signal death carries no position: the child may have died
    // mid-flip, so hold even though a pre-flip kill is also caught
    // (rare, and the operator confirms clean state before removing).
    if (error && typeof error === 'object' && (error.status === WORKER_UNRECONCILED_EXIT || error.signal != null)) {
      error.indeterminateDispatch = true;
    }
    throw error;
  }
}

// Bind the subprocess helpers to a working directory (the release
// entry point passes the repo root so git children resolve).
export function createRunner(cwd) {
  const command = (binary, args, capture = true, options = {}) =>
    run(binary, args, cwd, capture, options.timeoutMs);
  const gh = args =>
    // Every gh call is a bounded API read or dispatch: a hung child
    // must not wedge the polling loops or the multi-hour release.
    run('gh', args, cwd, true, API_COMMAND_TIMEOUT_MS);
  const vercelApi = path =>
    run('vercel', ['api', path, '--method', 'GET'], cwd, true, API_COMMAND_TIMEOUT_MS);
  return { command, gh, vercelApi };
}
