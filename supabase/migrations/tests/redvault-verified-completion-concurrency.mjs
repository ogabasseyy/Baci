import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function session(root, port, name, input, keepOpen = false) {
  const child = spawn('/opt/homebrew/bin/psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', port, '-U', 'postgres', '-d', 'postgres']);
  const state = { child, output: '', error: '', closed: false };
  state.done = new Promise((resolve, reject) => {
    child.stdout.on('data', value => { state.output += value; });
    child.stderr.on('data', value => { state.error += value; });
    child.on('error', reject);
    child.on('close', code => { state.closed = true; code === 0 ? resolve() : reject(new Error(`${name}: ${state.error}`)); });
  });
  state.done.catch(() => {});
  const script = `SET application_name = '${name}'; SET statement_timeout = '8s'; ${input}`;
  if (keepOpen) child.stdin.write(`${script}\n`); else child.stdin.end(script);
  return state;
}

async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(20);
  }
}

function approval() {
  return `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SET ROLE service_role;
    SELECT public.approve_and_complete_uba_redvault_payment('33333333-3333-4333-8333-333333333333'::uuid,(SELECT id FROM public.test_result),(SELECT evidence FROM public.test_verified_completion_914));`;
}

function resetHeld(sql) {
  sql(`BEGIN; INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    DELETE FROM public.payment_side_effects; DELETE FROM private.uba_redvault_refunds; DELETE FROM private.uba_redvault_redemptions;
    UPDATE private.uba_redvault_payment_attempts SET state='captured_held',provider_response=provider_response-'verified_evidence'-'completion_receipt'-'inventory_completion_receipt';
    UPDATE private.uba_redvault_applications SET status='pending'; UPDATE public.transactions SET status='pending';
    UPDATE public.orders SET payment_status='unpaid',shipping_status='pending',amount_paid=0,paid_at=NULL;
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current(); COMMIT;`);
}

function blocked(sql, waiting, holder) {
  return sql(`SELECT 'BLOCKED' FROM pg_catalog.pg_stat_activity w WHERE w.application_name='${waiting}' AND w.wait_event_type='Lock' AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity h WHERE h.application_name='${holder}' AND h.pid=ANY(pg_catalog.pg_blocking_pids(w.pid)));`).includes('BLOCKED');
}

export async function checkVerifiedCompletionConcurrency(root, port, sql) {
  const sessions = [];
  try {
    resetHeld(sql);
    const first = session(root, port, 'redvault_approval_one', approval());
    const second = session(root, port, 'redvault_approval_two', approval());
    sessions.push(first, second);
    await Promise.all([first.done, second.done]);
    if ([first.output, second.output].filter(value => value.includes('"duplicate": false')).length !== 1 || [first.output, second.output].filter(value => value.includes('"duplicate": true')).length !== 1 || !sql('SELECT count(*) FROM private.uba_redvault_redemptions;').match(/^\s*1\s*$/m)) throw new Error('two approvals did not produce exactly one receipt, one replay, and one redemption');

    resetHeld(sql);
    const refundHolder = session(root, port, 'redvault_refund_lock_holder', `BEGIN; SELECT id FROM private.uba_redvault_payment_attempts FOR UPDATE; SELECT 'LOCKED'; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SET ROLE service_role; SELECT * FROM public.reserve_uba_redvault_refund((SELECT attempt_id FROM public.test_attempt),'6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,'concurrency-refund-first','full_capture',NULL);`, true);
    sessions.push(refundHolder);
    await until(() => refundHolder.output.includes('LOCKED'), 'refund holder did not lock attempt');
    const blockedApproval = session(root, port, 'redvault_approval_waiting_refund', approval());
    sessions.push(blockedApproval);
    await until(() => blocked(sql, 'redvault_approval_waiting_refund', 'redvault_refund_lock_holder'), 'approval did not wait behind refund');
    refundHolder.child.stdin.end('COMMIT;');
    const refundFirstResults = await Promise.allSettled([refundHolder.done, blockedApproval.done]);
    if (refundFirstResults[0].status !== 'fulfilled' || refundFirstResults[1].status !== 'rejected' || !String(refundFirstResults[1].reason).includes('redvault_verified_completion_refund_pending') || !sql('SELECT count(*) FROM private.uba_redvault_redemptions;').match(/^\s*0\s*$/m) || !sql('SELECT payment_status FROM public.orders WHERE id=(SELECT id FROM public.test_result);').includes('unpaid')) throw new Error('refund-first race approved, redeemed, or paid the order');

    resetHeld(sql);
    sql(`CREATE FUNCTION public.redvault_test_approval_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='approved' AND OLD.state='captured_held' THEN PERFORM pg_catalog.pg_advisory_xact_lock(917001); END IF; RETURN NEW; END; $$; CREATE TRIGGER redvault_test_approval_gate BEFORE UPDATE OF state ON private.uba_redvault_payment_attempts FOR EACH ROW EXECUTE FUNCTION public.redvault_test_approval_gate();`);
    const gate = session(root, port, 'redvault_approval_gate_holder', "BEGIN; SELECT pg_catalog.pg_advisory_xact_lock(917001); SELECT 'GATE';", true);
    sessions.push(gate);
    await until(() => gate.output.includes('GATE'), 'approval gate not acquired');
    const gatedApproval = session(root, port, 'redvault_approval_holding_attempt', approval());
    sessions.push(gatedApproval);
    await until(() => blocked(sql, 'redvault_approval_holding_attempt', 'redvault_approval_gate_holder'), 'approval did not enter gate');
    const waitingRefund = session(root, port, 'redvault_refund_waiting_approval', `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false); SET ROLE service_role; SELECT * FROM public.reserve_uba_redvault_refund((SELECT attempt_id FROM public.test_attempt),'6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid,'concurrency-approval-first','full_capture',NULL);`);
    sessions.push(waitingRefund);
    await until(() => blocked(sql, 'redvault_refund_waiting_approval', 'redvault_approval_holding_attempt'), 'refund did not wait behind approval');
    gate.child.stdin.end('COMMIT;');
    await Promise.all([gate.done, gatedApproval.done, waitingRefund.done]);
    sql('DROP TRIGGER redvault_test_approval_gate ON private.uba_redvault_payment_attempts; DROP FUNCTION public.redvault_test_approval_gate();');
    if (!gatedApproval.output.includes('"duplicate": false')
      || !waitingRefund.output.includes('pending')
      || !sql('SELECT count(*) FROM private.uba_redvault_redemptions;').match(/^\s*1\s*$/m)
      || !sql("SELECT state FROM private.uba_redvault_payment_attempts;").includes('approved')
      || !sql("SELECT status FROM private.uba_redvault_applications;").includes('approved')
      || !sql("SELECT payment_status = 'paid' AS is_paid FROM public.orders WHERE id=(SELECT id FROM public.test_result);").match(/^\s*t\s*$/m)
      || !sql("SELECT provider_response->'completion_receipt'->>'order_updated' FROM private.uba_redvault_payment_attempts;").includes('true')
      || !sql("SELECT provider_response->'inventory_completion_receipt'->>'inventoryConfirmed' FROM private.uba_redvault_payment_attempts;").includes('true')) {
      throw new Error('approval-first race did not leave durable approved, paid, inventory-confirmed receipt state');
    }
    resetHeld(sql);
    process.stdout.write('Verified completion approval/refund concurrency checks passed.\n');
  } finally {
    for (const state of sessions) if (!state.closed) state.child.kill('SIGTERM');
    await Promise.allSettled(sessions.map(state => state.done));
  }
}
