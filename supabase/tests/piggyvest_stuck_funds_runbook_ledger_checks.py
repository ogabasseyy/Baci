"""Ledger checks for run_piggyvest_stuck_funds_runbook.py.

Only completed ledger rows count as money taken or returned, and the wallet-versus-ledger
comparison must not hinge on an arbitrary tie-break between rows that share a timestamp.
"""

MERCHANT = '00000000-0000-4000-8000-0000000000a1'
OTHER_MERCHANT = '00000000-0000-4000-8000-0000000000a2'
ORDER = '00000000-0000-4000-8000-0000000000b1'
ORDER_CUSTOMER = '00000000-0000-4000-8000-0000000000c1'
ORDER_WALLET = '00000000-0000-4000-8000-0000000000e1'
VTU = '00000000-0000-4000-8000-000000000101'
VTU_CUSTOMER = '00000000-0000-4000-8000-0000000000c2'
VTU_WALLET = '00000000-0000-4000-8000-0000000000e2'
CLOSE_INTENTS = "UPDATE public.order_wallet_funding_intents SET status = 'cancelled';"
ROW = """INSERT INTO public.customer_wallet_transactions (id, wallet_id, customer_id,
  merchant_id, type, amount, balance_after, source_type, source_id, status, created_at)
  VALUES ('{id}', '{wallet}', '{customer}', '{merchant}', 'adjustment', {amount}, {balance},
  '{source_type}', {source_id}, '{status}', '{at}');"""


def row(row_id, wallet, customer, balance, source_type='wallet_topup', source_id='NULL',
        status='completed', amount='1.00', at='2026-10-03T10:00:00Z'):
    return ROW.format(id=row_id, wallet=wallet, customer=customer, merchant=MERCHANT,
                      amount=amount, balance=balance, source_type=source_type,
                      source_id=source_id, status=status, at=at)


def order_status_checks(rb):
    """A reversal or redemption that is not completed neither hides nor creates held money."""
    check = rb.check
    o1, o2 = rb.blocks['O1'], rb.block('O2', **{'PASTE-ORDER-ID': ORDER})
    for status in ('pending', 'failed', 'expired'):
        rb.fresh()
        rb.cluster.must(rb.db, CLOSE_INTENTS + row(
            '00000000-0000-4000-8000-00000000cc01', ORDER_WALLET, ORDER_CUSTOMER, '500.00',
            'order_reversal', f"'{ORDER}'", status, '10000.00'))
        rc, out, err = rb.sql(o1)
        check(rc == 0 and len(out.splitlines()) == 1 and out.split('|')[5] == '10000.00',
              f'O1 still lists the order when its reversal is {status}: {out or err}')
        rc, out, err = rb.sql(o2)
        check(rc == 0 and out.split('|')[3:5] == ['10000.00', '0'],
              f'O2 does not count a {status} reversal as returned: {out or err}')
    # The funding intents are closed first, so only the wallet-money arm of O1 can list the order.
    rb.fresh()
    rb.cluster.must(rb.db, CLOSE_INTENTS + f"""UPDATE public.customer_wallet_transactions
      SET status = 'pending' WHERE source_id = '{ORDER}' AND source_type = 'order_redemption'""")
    rc, out, err = rb.sql(o1)
    check(rc == 0 and out == '', f'O1 ignores a redemption that is not completed: {out or err}')
    rc, out, err = rb.sql(o2)
    check(rc == 0 and out.split('|')[3:5] == ['0', '0'],
          f'O2 does not count a redemption that is not completed as taken: {out or err}')


def debit_display_checks(rb):
    """V1 and V4 show money actually taken, so a debit that is not completed reads 0."""
    check = rb.check
    rb.fresh()
    rb.cluster.must(rb.db, f"""UPDATE public.customer_wallet_transactions SET status = 'pending'
      WHERE source_id = '{VTU}' AND source_type = 'vtu_wallet_payment'""")
    rc, out, err = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out.split('|')[9] == '0',
          f'V1 shows a debit that is not completed as 0: {out or err}')
    rc, out, err = rb.v4()
    check(rc == 0 and out.split('|')[2] == '0',
          f'V4 shows a debit that is not completed as 0: {out or err}')


def return_checks(rb):
    """V1 and V4 count a return only once it is completed; V3 stops on a return in any status."""
    check = rb.check
    rb.fresh()
    rb.cluster.must(rb.db,
                    row('00000000-0000-4000-8000-00000000dd01', VTU_WALLET, VTU_CUSTOMER, '153.00',
                        'vtu_wallet_reversal', f"'{VTU}'", 'pending', '103.00')
                    + row('00000000-0000-4000-8000-00000000dd02', VTU_WALLET, VTU_CUSTOMER,
                          '153.00', 'vtu_transaction_refund', f"'{VTU}'", 'pending', '103.00'))
    rc, out, err = rb.sql(rb.blocks['V1'])
    check(rc == 0 and out.split('|')[10:12] == ['0', '0'],
          f'V1 does not count a return that is not completed: {out or err}')
    rc, out, err = rb.v4()
    check(rc == 0 and out.split('|')[3:5] == ['0', '0'],
          f'V4 does not count a return that is not completed: {out or err}')
    before = rb.state()
    for outcome in ('failed', 'delivered'):
        rc, _, err = rb.v3(True, outcome)
        check(rc != 0 and err.startswith('ERROR:  STOP') and 'already returned' in err
              and rb.state() == before, f'V3 {outcome} stops on a pending return: {err[:140]}')


def tie_checks(rb):
    """Ledger rows written in one transaction share created_at and have random ids. The wallet
    matches its ledger only when its balance equals the newest entry, and when several entries
    share the newest timestamp only if they all show that balance: with differing balances the
    last one cannot be told, so the check reads false instead of trusting an arbitrary pick."""
    check = rb.check
    cases = [('V4', rb.block('V4', **{'PASTE-VTU-ID': VTU}), 5, VTU_WALLET, VTU_CUSTOMER,
              '50.00', '153.00'),
             ('O2', rb.block('O2', **{'PASTE-ORDER-ID': ORDER}), 7, ORDER_WALLET,
              ORDER_CUSTOMER, '500.00', '10500.00')]
    low, high = '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000bb01'
    for label, sql, column, wallet, customer, balance, older in cases:
        def match(expected, message):
            rc, out, err = rb.sql(sql)
            check(rc == 0 and out.split('|')[column] == expected,
                  f'{label} {message}: {out or err}')

        def set_balance(row_id, value):
            rb.cluster.must(rb.db, f"""UPDATE public.customer_wallet_transactions
              SET balance_after = {value} WHERE id = '{row_id}'""")

        rb.fresh()
        rb.cluster.must(rb.db, row(low, wallet, customer, balance)
                        + row(high, wallet, customer, balance))
        match('t', 'matches when every entry tied for newest shows the wallet balance')
        set_balance(high, '999.00')
        match('f', 'reads false when the tied entry with the higher id disagrees')
        set_balance(high, balance)
        set_balance(low, '999.00')
        match('f', 'reads false when the tied entry with the lower id disagrees')
        set_balance(low, balance)
        rb.cluster.must(rb.db, f"""UPDATE public.customer_wallets SET available_balance = {older}
          WHERE id = '{wallet}'""")
        match('f', 'rejects a wallet that equals only an older ledger entry')
        rb.cluster.must(rb.db, f"""UPDATE public.customer_wallets SET available_balance = NULL
          WHERE id = '{wallet}'""")
        match('f', 'reads false for a wallet with no balance')


def missing_wallet_checks(rb):
    rb.fresh()
    rb.cluster.must(rb.db, f"""UPDATE public.customer_wallets SET merchant_id = '{OTHER_MERCHANT}'
      WHERE id = '{ORDER_WALLET}'""")
    rc, out, err = rb.sql(rb.block('O2', **{'PASTE-ORDER-ID': ORDER}))
    rb.check(rc == 0 and len(out.splitlines()) == 1 and out.split('|')[-1] == 'f',
             f'O2 shows a missing wallet as a mismatch: {out or err}')


def refund_status_checks(rb):
    """O1 counts a payment that is being or has been refunded as a completed payment, so the
    stop rule trips for it; the fixture must be able to hold those statuses to prove it."""
    for status in ('refund_pending', 'refunded'):
        rb.fresh()
        rb.cluster.must(rb.db, f"""INSERT INTO public.transactions (merchant_id, order_id,
          transaction_type, amount, currency, status, gateway, gateway_reference) VALUES
          ('{MERCHANT}', '{ORDER}', 'payment', 5000.00, 'NGN', '{status}', 'paystack',
           'PSK-TEST-{status}')""")
        rc, out, err = rb.sql(rb.blocks['O1'])
        rb.check(rc == 0 and out.split('|')[7:9] == ['0', '1'],
                 f'O1 counts a {status} payment as a completed payment: {out or err}')


def run(rb):
    refund_status_checks(rb)
    order_status_checks(rb)
    debit_display_checks(rb)
    return_checks(rb)
    tie_checks(rb)
    missing_wallet_checks(rb)
