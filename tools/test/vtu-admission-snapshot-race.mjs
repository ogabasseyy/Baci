import assert from 'node:assert/strict';
import { Client } from 'pg';

// Pause the real customer resolver after admission has started, commit a
// terminal update, and check the admission snapshot still includes the row.
export async function verifyAdmissionSnapshotRace(admin, config) {
  await admin.query(`
    INSERT INTO public.merchants (id, slug) VALUES ('10000000-0000-4000-8000-000000000001', 'race-store');
    INSERT INTO auth.users (id,email,email_confirmed_at) VALUES ('20000000-0000-4000-8000-000000000001','race@example.test',now());
    INSERT INTO public.customers (id,merchant_id,user_id) VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
    INSERT INTO public.vtu_transactions (id,merchant_id,customer_id,status) VALUES ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','pending');
    INSERT INTO public.vtu_transactions (id,merchant_id,customer_id,status,source,amount,metadata) VALUES ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','pending','checkout',500,'{"paymentSplit":{"wallet":500,"card":0}}');
    INSERT INTO public.vtu_idempotency_keys (key,vtu_transaction_id,merchant_id,customer_id,request_fingerprint) VALUES ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','race-fingerprint');
    ALTER FUNCTION public._vtu_checkout_caller_customer(uuid,uuid) RENAME TO _vtu_checkout_caller_customer_original;
    CREATE FUNCTION public._vtu_checkout_caller_customer(uuid,uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(27491);
      RETURN public._vtu_checkout_caller_customer_original($1,$2);
    END $$;
  `);
  const caller = new Client(config);
  const holder = new Client(config);
  const writer = new Client(config);
  await caller.connect();
  await holder.connect();
  await writer.connect();
  try {
    await caller.query(
      "SELECT set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false)"
    );
    const pid = (await caller.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid;
    async function runRace() {
      await writer.query('BEGIN');
      await writer.query('SELECT transaction_timestamp()');
      await holder.query('SELECT pg_advisory_lock(27491)');
      const proof = caller.query(
        "SELECT * FROM public.vtu_admission_proof('race-store','race-fingerprint')"
      );
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) AS waiting",
          [pid]
        );
        if (result.rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(waiting, 'admission did not reach paused resolver');
      await writer.query(
        "UPDATE public.vtu_transactions SET status='successful', terminal_at=transaction_timestamp() WHERE id='40000000-0000-4000-8000-000000000001'"
      );
      await writer.query('COMMIT');
      await holder.query('SELECT pg_advisory_unlock(27491)');
      return (await proof).rows[0];
    }
    const stableProof = await runRace();
    assert.deepEqual(stableProof.live_transaction_ids, [
      '40000000-0000-4000-8000-000000000001',
    ]);
    const claim = await caller.query(
      "SELECT * FROM public.claim_vtu_intent('50000000-0000-4000-8000-000000000002','race-fingerprint','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',$1,$2)",
      [stableProof.admitted_at, stableProof.live_transaction_ids]
    );
    assert.equal(claim.rows[0].created, false);
    assert.equal(
      claim.rows[0].transaction_id,
      '40000000-0000-4000-8000-000000000001'
    );
    // A volatile admission takes a fresh snapshot for the final query. This
    // negative control verifies that the regression detects Muse's scenario.
    await admin.query(
      "UPDATE public.vtu_transactions SET status='pending', terminal_at=NULL WHERE id='40000000-0000-4000-8000-000000000001'"
    );
    await admin.query(
      'ALTER FUNCTION public.vtu_admission_proof(text,text) VOLATILE'
    );
    assert.deepEqual((await runRace()).live_transaction_ids, []);
  } finally {
    await holder.query('SELECT pg_advisory_unlock_all()').catch(() => {
      // Closing the session also releases its advisory locks.
    });
    await caller.end();
    await holder.end();
    await writer.end();
  }
}
