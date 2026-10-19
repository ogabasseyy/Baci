import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkCaptureConcurrency(root, port, sql) {
  const sessions = [];
  function session(name) {
    const child = spawn('/opt/homebrew/bin/psql', [
      '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', port,
      '-U', 'postgres', '-d', 'postgres',
    ]);
    const state = { child, output: '', error: '', closed: false };
    state.done = new Promise((resolve, reject) => {
      child.stdout.on('data', value => { state.output += value; });
      child.stderr.on('data', value => { state.error += value; });
      child.on('error', reject);
      child.on('close', code => {
        state.closed = true;
        if (code === 0) resolve();
        else reject(new Error(name + ': ' + state.error));
      });
    });
    state.done.catch(() => {});
    child.stdin.write("SET application_name = '" + name + "'; SET statement_timeout = '8s';\n");
    sessions.push(state);
    return state;
  }
  async function until(predicate, description) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(description);
      await delay(20);
    }
  }
  try {
    const holder = session('redvault_reverse_lock_holder');
    holder.child.stdin.write(`
      BEGIN;
      SELECT id FROM private.uba_redvault_payment_attempts
      WHERE order_id = (SELECT id FROM public.test_result) FOR UPDATE;
      SELECT 'ATTEMPT_LOCKED';
    `);
    await until(() => holder.output.includes('ATTEMPT_LOCKED'), 'attempt lock not acquired');
    const capture = session('redvault_reverse_lock_capture');
    capture.child.stdin.end(`
      SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
      SET ROLE service_role;
      SELECT public.capture_or_hold_uba_redvault_payment(
        '33333333-3333-4333-8333-333333333333'::uuid,
        (SELECT id FROM public.test_result), 'paystack',
        (SELECT reference FROM public.test_attempt LIMIT 1),
        jsonb_build_object(
          'amount', (SELECT amount_kobo FROM public.test_attempt LIMIT 1),
          'currency', 'NGN',
          'reference', (SELECT reference FROM public.test_attempt LIMIT 1),
          'status', 'success'
        )
      );
    `);
    await until(() => sql(`
      SELECT 'CAPTURE_BLOCKED' FROM pg_catalog.pg_stat_activity AS capture
      WHERE capture.application_name = 'redvault_reverse_lock_capture'
        AND capture.wait_event_type = 'Lock'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity AS holder
          WHERE holder.application_name = 'redvault_reverse_lock_holder'
            AND holder.pid = ANY(pg_catalog.pg_blocking_pids(capture.pid))
        );
    `).includes('CAPTURE_BLOCKED'), 'capture never waited behind attempt lock');
    holder.child.stdin.end(`
      SELECT id FROM private.uba_redvault_applications
      WHERE order_id = (SELECT id FROM public.test_result) FOR SHARE;
      COMMIT;
    `);
    await Promise.all([holder.done, capture.done]);
    if (!capture.output.includes('"kind": "captured_held"')
      || !capture.output.includes('"duplicate": true')) {
      throw new Error('concurrent capture did not return held duplicate: ' + capture.output);
    }
    process.stdout.write('Capture reverse-lock concurrency check passed.\n');
  } finally {
    for (const state of sessions) {
      if (!state.closed) state.child.kill('SIGTERM');
    }
    await Promise.allSettled(sessions.map(state => state.done));
  }
}
