"""V3 and V4 checks for run_piggyvest_stuck_funds_runbook.py (the airtime purchase)."""

VTU = '00000000-0000-4000-8000-000000000101'
VTU_OTHER = '00000000-0000-4000-8000-000000000109'
WALLET = '00000000-0000-4000-8000-0000000000e2'
REFUNDED = 'failed|vendor_confirmed_failed|153.00|2'


def meta(rb, *keys):
    columns = ', '.join(f"coalesce(metadata->>'{key}', '')" for key in keys)
    return rb.sql(f"SELECT {columns} FROM public.vtu_transactions WHERE id = '{VTU}'")[1]


def update(rb, assignment):
    rb.cluster.must(rb.db, f"UPDATE public.vtu_transactions SET {assignment} WHERE id = '{VTU}'")


def split(card, wallet):
    return f"""metadata = jsonb_set(jsonb_set(metadata, '{{paymentSplit,card}}', '{card}'),
      '{{paymentSplit,wallet}}', '{wallet}')"""


def failed_answer_checks(rb):
    check = rb.check
    rb.fresh()
    before = rb.state()
    rc, _, err = rb.v3(False, 'failed')
    check(rc != 0 and 'DRY RUN OK' in err and 'return 103.00' in err and rb.state() == before,
          f'V3 failed dry run changes nothing: {err[:140]}')
    rc, _, err = rb.v3(True, 'failed')
    check(rc == 0, f'V3 failed applies: {err[:140]}')
    check(rb.state() == REFUNDED, f'V3 returns exactly 103: {rb.state()}')
    rc, out, err = rb.v4()
    check(rc == 0 and out == 'failed|vendor_confirmed_failed|103.00|103.00|0|t|f',
          f'V4 confirms failure: {out or err}')
    rc, out, _ = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out == '', 'V1 is empty after the reversal')
    marks = meta(rb, 'refundIssued', 'refundAmount', 'refundContext', 'walletDebited')
    check(marks == 'true|0|hybrid_vend_failure|true',
          f'V3 writes the normal refund markers: {marks}')
    terminal = rb.sql("SELECT terminal_at IS NOT NULL, error_message FROM public.vtu_transactions"
                      f" WHERE id = '{VTU}'")[1]
    check(terminal.startswith('t|Vendor confirmed'),
          f'V3 stamps the terminal transition: {terminal}')
    after = rb.state()
    for outcome in ['failed', 'delivered']:
        rc, _, err = rb.v3(True, outcome)
        check(rc != 0 and 'not processing' in err and rb.state() == after,
              f'V3 re-run ({outcome}) is refused')

    rb.fresh()
    update(rb, """metadata = metadata || '{"refundSkipped": "no_charge"}'::jsonb""")
    rc, _, err = rb.v3(True, 'failed')
    marks = rb.sql("SELECT metadata ? 'refundSkipped', metadata->>'refundIssued'"
                   f" FROM public.vtu_transactions WHERE id = '{VTU}'")[1]
    check(rc == 0 and marks == 'f|true' and rb.state() == REFUNDED,
          f'V3 clears a stale refundSkipped marker when it refunds: {marks} {err[:140]}')

    rb.fresh()
    rc, _, err = rb.v3(True, 'failed', vtu='PASTE-VTU-ID')
    check(rc != 0 and 'uuid' in err, 'V3 refuses an unfilled id')

    rb.fresh()
    rb.cluster.must(rb.db, f"""DELETE FROM public.customer_wallet_transactions
      WHERE source_id = '{VTU}';
      UPDATE public.customer_wallets SET available_balance = 153.00 WHERE id = '{WALLET}'""")
    update(rb, "metadata = metadata - 'walletDebited'")
    rc, _, err = rb.v3(True, 'failed')
    marks = rb.sql("SELECT status, metadata->>'refundSkipped', metadata->>'refundIssued'"
                   f" FROM public.vtu_transactions WHERE id = '{VTU}'")[1]
    check(rc == 0 and marks == 'failed|no_charge|' and rb.state().endswith('|153.00|0'),
          f'V3 closes an uncharged purchase with no credit: {marks} {err[:140]}')

    rb.fresh()
    update(rb, "metadata = metadata - 'walletDebited'")
    rc, _, err = rb.v3(True, 'failed')
    check(rc == 0 and meta(rb, 'walletDebited') == 'true' and rb.state() == REFUNDED,
          f'V3 reverses a debited purchase whose wallet flag was never written: {err[:140]}')


def refusal_checks(rb):
    """Every shape outside the approved one raises STOP and changes nothing."""
    check = rb.check
    refunded = f"""INSERT INTO public.customer_wallet_transactions (wallet_id, customer_id,
      merchant_id, type, amount, balance_after, source_type, source_id) VALUES ('{WALLET}',
      '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'refund',
      103.00, 153.00, 'vtu_transaction_refund', '{VTU}')"""
    nodebit = f"DELETE FROM public.customer_wallet_transactions WHERE source_id = '{VTU}'"
    vtu_row = f"UPDATE public.vtu_transactions SET {{}} WHERE id = '{VTU}'"
    wallet_only = dict.fromkeys(['failed', 'delivered'], 'not a wallet-only purchase')
    not_completed = dict.fromkeys(['failed', 'delivered'], 'is not completed')
    debit_status = ('UPDATE public.customer_wallet_transactions SET status = {} '
                    f"WHERE source_id = '{VTU}' AND source_type = 'vtu_wallet_payment'")
    cases = [
        ('wrong amount', '', '100.00', VTU, 'OPS-TEST-1',
         {'failed': 'does not match', 'delivered': 'does not match'}),
        ('card leg', vtu_row.format(split('50', '103')), '103.00', VTU, 'OPS-TEST-1', wallet_only),
        ('no split', vtu_row.format("metadata = metadata - 'paymentSplit'"), '103.00', VTU,
         'OPS-TEST-1', wallet_only),
        ('other merchant', '', '103.00', VTU_OTHER, 'OPS-TEST-1',
         {'failed': 'no Ogabassey purchase', 'delivered': 'no Ogabassey purchase'}),
        ('not airtime', vtu_row.format("type = 'data'"), '103.00', VTU, 'OPS-TEST-1',
         {'failed': 'does not match', 'delivered': 'does not match'}),
        ('missing evidence', '', '103.00', VTU, None,
         {'failed': 'v_evidence', 'delivered': 'v_evidence'}),
        ('already returned', refunded, '103.00', VTU, 'OPS-TEST-1',
         {'failed': 'already returned', 'delivered': 'already returned'}),
        ('flag without debit', nodebit, '103.00', VTU, 'OPS-TEST-1',
         {'failed': 'escalate', 'delivered': 'not paid'}),
        ('pending, not processing', vtu_row.format("status = 'pending'"), '103.00', VTU,
         'OPS-TEST-1', {'failed': 'not processing', 'delivered': 'not processing'}),
        ('unknown outcome', '', '103.00', VTU, 'OPS-TEST-1', {'refunded': 'failed or delivered'}),
        ('missing amount', '', 'NULL', VTU, 'OPS-TEST-1',
         dict.fromkeys(['failed', 'delivered'], 'v_amount')),
        # A malformed paymentSplit must raise the documented STOP, never a cast error. The app
        # only reads a split whose card and wallet are both JSON numbers.
        ('non-numeric card', vtu_row.format(split('"abc"', '103')), '103.00', VTU, 'OPS-TEST-1',
         wallet_only),
        ('non-numeric wallet', vtu_row.format(split('0', '"1O3"')), '103.00', VTU, 'OPS-TEST-1',
         wallet_only),
        ('numbers stored as text', vtu_row.format(split('"0"', '"103"')), '103.00', VTU,
         'OPS-TEST-1', wallet_only),
        ('nested wallet object', vtu_row.format(split('0', '{"amount": 103}')), '103.00', VTU,
         'OPS-TEST-1', wallet_only),
        ('split as a list', vtu_row.format(
            """metadata = jsonb_set(metadata, '{paymentSplit}', '[103, 0]')"""), '103.00', VTU,
         'OPS-TEST-1', wallet_only),
        # The ledger status column is nullable: a debit that is not completed, a missing status
        # included, is not money taken, and the refund function would still credit it.
        *[(f'a {name} wallet debit', debit_status.format(status), '103.00', VTU, 'OPS-TEST-1',
           not_completed) for name, status in [('pending', "'pending'"), ('failed', "'failed'"),
                                               ('expired', "'expired'"), ('status-less', 'NULL')]],
    ]
    for name, setup, amount, vtu, evidence, outcomes in cases:
        for outcome, expect in outcomes.items():
            rb.fresh()
            if setup:
                rb.cluster.must(rb.db, setup)
            before = rb.state(vtu)
            rc, _, err = rb.v3(True, outcome, amount, vtu, evidence)
            check(rc != 0 and err.startswith('ERROR:  STOP') and expect in err
                  and rb.state(vtu) == before, f'V3 {outcome} refuses {name}: {err[:140]}')

    rb.fresh()
    update(rb, split('0.00', '103.0'))
    rc, _, err = rb.v3(False, 'failed')
    check(rc != 0 and 'DRY RUN OK' in err, f'V3 accepts a numeric split with decimals: {err[:140]}')
    update(rb, split('"abc"', '103'))
    rc, out, err = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out.split('|')[7:9] == ['103', 'abc'],
          f'V1 still lists a purchase with a malformed split: {out or err}')


def fallback_checks(rb):
    """A Monnify-to-Kuda fallback row carries Monnify-rate commission and cashback; the app
    corrects them before it records success, V3 cannot, so it refuses "delivered"."""
    check = rb.check
    rb.fresh()
    rc, out, err = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out.split('|')[6] == '',
          f'V1 shows an empty provider_fallback for a normal purchase: {out or err}')
    update(rb, """metadata = metadata || '{"provider": "kuda", "originalProvider": "monnify",
      "providerFallback": "monnify_airtime_to_kuda"}'::jsonb,
      merchant_commission = 2.06, customer_cashback = 1.03""")
    rc, out, err = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out.split('|')[5:7] == ['kuda', 'monnify_airtime_to_kuda'],
          f'V1 shows the re-routed vendor and provider_fallback: {out or err}')
    money = ("SELECT merchant_commission, customer_cashback FROM public.vtu_transactions"
             f" WHERE id = '{VTU}'")
    before, amounts = rb.state(), rb.sql(money)[1]
    for apply in (False, True):
        rc, _, err = rb.v3(apply, 'delivered')
        check(rc != 0 and err.startswith('ERROR:  STOP') and 'fallback' in err
              and rb.state() == before and rb.sql(money)[1] == amounts,
              f'V3 delivered refuses a re-routed purchase (apply={apply}): {err[:140]}')
    rc, _, err = rb.v3(True, 'failed')
    check(rc == 0 and rb.state() == REFUNDED,
          f'V3 failed still returns exactly 103 on a re-routed purchase: {rb.state()} {err[:140]}')


def delivered_checks(rb):
    check = rb.check
    settled = 'successful|vendor_confirmed_delivered|103.00|0|0|t|f'
    rb.fresh()
    before = rb.state()
    rc, _, err = rb.v3(False, 'delivered')
    check(rc != 0 and 'DRY RUN OK' in err and 'return 0' in err and rb.state() == before,
          f'V3 delivered dry run changes nothing: {err[:140]}')
    rc, _, err = rb.v3(True, 'delivered')
    check(rc == 0 and rb.state() == 'successful|vendor_confirmed_delivered|50.00|1',
          f'V3 delivered moves no money: {rb.state()} {err[:140]}')
    rc, out, err = rb.v4()
    check(rc == 0 and out == settled, f'V4 confirms delivery: {out or err}')
    em = rb.sql("SELECT coalesce(error_message, '-'), metadata ? 'refundIssued'"
                f" FROM public.vtu_transactions WHERE id = '{VTU}'")[1]
    check(em == '-|f', f'V3 delivered clears the error and claims no refund: {em}')

    # After "delivered", V4 shows whether commission, cashback or points await the checker.
    rb.fresh()
    update(rb, 'merchant_commission = 2.06, customer_cashback = 1.03')
    rc, _, err = rb.v3(True, 'delivered')
    rc2, out, err2 = rb.v4()
    check(rc == 0 and rc2 == 0 and out == 'successful|vendor_confirmed_delivered|103.00|0|0|t|t',
          f'V4 shows credits still pending after delivered: {out or err or err2}')
    update(rb, """metadata = metadata || '{"customerWalletCredited": true}'::jsonb""")
    rc, out, err = rb.v4()
    check(rc == 0 and out.endswith('|t|t'),
          f'V4 keeps credits pending until the merchant commission is credited: {out or err}')
    update(rb, """metadata = metadata || '{"merchantWalletCredited": true}'::jsonb""")
    rc, out, err = rb.v4()
    check(rc == 0 and out == settled, f'V4 clears credits pending once settled: {out or err}')

    rb.fresh()
    update(rb, """merchant_commission = 0.50, customer_cashback = 3.00, metadata = metadata ||
      '{"merchantWalletCredited": true, "customerWalletCredited": true}'::jsonb""")
    rc, _, err = rb.v3(True, 'delivered')
    rc2, out, err2 = rb.v4()
    check(rc == 0 and rc2 == 0 and out.endswith('|t|t'),
          f'V4 keeps credits pending until loyalty points are awarded: {out or err or err2}')
    update(rb, """metadata = metadata || '{"loyaltyPointsAwarded": true}'::jsonb""")
    rc, out, err = rb.v4()
    check(rc == 0 and out.endswith('|t|f'),
          f'V4 clears credits pending once loyalty points are awarded: {out or err}')

    rb.fresh()
    rb.cluster.must(rb.db, f"""UPDATE public.customer_wallets
      SET merchant_id = '00000000-0000-4000-8000-0000000000a2' WHERE id = '{WALLET}'""")
    rc, out, err = rb.v4()
    check(rc == 0 and len(out.splitlines()) == 1 and out.split('|')[5] == 'f',
          f'V4 shows a missing wallet as a mismatch: {out or err}')


def null_input_checks(rb):
    """A NULL typed in place of the answer or the apply flag must never pass a check: the
    answer stops V3, and the flag leaves it a dry run."""
    base = rb.v3_sql(True, 'failed')
    for old, new, expect in [
            ("v_outcome  text    := 'failed'", 'v_outcome  text    := NULL', 'failed or delivered'),
            ('v_apply    boolean := true', 'v_apply    boolean := NULL', 'DRY RUN OK')]:
        rb.fresh()
        before = rb.state()
        assert old in base, old
        rc, _, err = rb.sql(base.replace(old, new))
        rb.check(rc != 0 and expect in err and rb.state() == before,
                 f'V3 changes nothing when {new.split(":=")[0].strip()} is NULL: {err[:140]}')


def clock_checks(rb):
    """V3 stamps its markers with the clock once it holds its locks, not with the transaction
    start. pg_sleep stands in for a lock wait: it holds the transaction open before V3 runs."""
    rb.fresh()
    sql = ("BEGIN;\nSELECT now() AS t0 \\gset\nSELECT pg_sleep(0.1) AS slept \\gset\n"
           + rb.v3_sql(True, 'failed') + "\nCOMMIT;\n"
           "SELECT (metadata->'opsResolution'->>'recordedAt')::timestamptz - :'t0'::timestamptz"
           " >= interval '90 milliseconds', (metadata->>'refundedAt')::timestamptz"
           f" - :'t0'::timestamptz >= interval '90 milliseconds' FROM public.vtu_transactions"
           f" WHERE id = '{VTU}'")
    rc, out, err = rb.sql(sql)
    rb.check(rc == 0 and out == 't|t', f'V3 stamps recordedAt and refundedAt after its locks: '
                                       f'{out or err[:140]}')


def run(rb):
    null_input_checks(rb)
    clock_checks(rb)
    failed_answer_checks(rb)
    refusal_checks(rb)
    fallback_checks(rb)
    delivered_checks(rb)
    rb.check('fails closed' in rb.text, 'SQL header states that V3 fails closed on drift')
