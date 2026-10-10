import json
import selectors
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor


def assert_treasury_precedes_intent(testcase, scope, selection):
    harness = testcase.harness
    arguments = [str(testcase.module.BIN / 'psql'), '-X', '-w', '-qAt',
                 '-v', 'ON_ERROR_STOP=1', '-h', str(harness.path),
                 '-p', '55461', '-U', 'harness_admin', '-d', 'postgres']
    holder = subprocess.Popen(arguments, env=harness.environment,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL)
    if holder.stdin is None or holder.stdout is None:
        holder.terminate()
        holder.wait(timeout=5)
        raise RuntimeError('scratch lock holder unavailable')
    pool = ThreadPoolExecutor(max_workers=1)
    worker = None
    try:
        holder.stdin.write((
            "BEGIN; SET LOCAL statement_timeout='20s'; "
            "SET LOCAL idle_in_transaction_session_timeout='20s'; "
            "DO $$ BEGIN PERFORM id FROM prefunded_card.treasury_bindings "
            f"WHERE id='{scope['treasuryBindingId']}' FOR UPDATE; END $$; "
            "SELECT 'treasury_locked';\n"
        ).encode())
        holder.stdin.flush()
        with selectors.DefaultSelector() as selector:
            selector.register(holder.stdout, selectors.EVENT_READ)
            testcase.assertTrue(selector.select(timeout=10), 'treasury holder did not acquire its lock')
            testcase.assertEqual(holder.stdout.readline().strip(), b'treasury_locked')

        scope_json = json.dumps(scope).replace("'", "''")
        selection_json = json.dumps(selection).replace("'", "''")
        worker = pool.submit(harness.sql,
            "BEGIN; SET LOCAL application_name='first_card_lock_regression'; "
            "SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='12s'; "
            f"SELECT prefunded_card.checkout_claim_initialization('{scope_json}'::jsonb,"
            f"'{selection_json}'::jsonb); ROLLBACK;", 'prefunded_authorizer')
        deadline = time.monotonic() + 10
        waiting = False
        while time.monotonic() < deadline:
            if worker.done():
                worker.result()
                testcase.fail('checkout initialization bypassed the held treasury lock')
            waiting = harness.sql(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE "
                "application_name='first_card_lock_regression' AND wait_event_type='Lock')"
            ) == 't'
            if waiting:
                break
        testcase.assertTrue(waiting, 'checkout did not wait for treasury')
        harness.sql(
            "BEGIN; SET LOCAL lock_timeout='1s'; "
            "SELECT id FROM prefunded_card.checkout_intents "
            f"WHERE id='{selection['intentId']}' FOR UPDATE NOWAIT; ROLLBACK;"
        )
        holder.stdin.write(b'ROLLBACK;\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=5)
        worker.result(timeout=15)
    finally:
        if holder.poll() is None:
            holder.terminate()
            try:
                holder.wait(timeout=5)
            except subprocess.TimeoutExpired:
                holder.kill()
                holder.wait(timeout=5)
        holder.stdin.close()
        holder.stdout.close()
        pool.shutdown(wait=True, cancel_futures=True)
