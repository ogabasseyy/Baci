#!/usr/bin/env python3
"""Fixture checks for docs/runbooks/piggyvest-stuck-legacy-funds.sql.

Run from the repository root: python3 -I supabase/tests/run_piggyvest_stuck_funds_runbook.py

Needs PostgreSQL 15 or newer server binaries: PG_BIN names their directory, otherwise
`pg_config --bindir` is used. The runner creates a throwaway cluster in a temporary
directory that listens on a private Unix socket only (no TCP), loads the fixture schema,
the latest real bodies of the functions the runbook relies on (read from
supabase/migrations) and the synthetic seed, then runs each runbook block exactly as
written with only its PASTE values filled in. It never connects to any other database.
"""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import piggyvest_stuck_funds_runbook_ledger_checks as ledger_checks  # noqa: E402
import piggyvest_stuck_funds_runbook_vtu_checks as vtu_checks  # noqa: E402
from piggyvest_stuck_funds_runbook_sources import real_function, real_trigger  # noqa: E402

RUNBOOK_SQL = ROOT / 'docs/runbooks/piggyvest-stuck-legacy-funds.sql'
FIXTURE = HERE / 'piggyvest_stuck_funds_runbook_fixture.sql'
SEED = HERE / 'piggyvest_stuck_funds_runbook_seed.sql'
REAL_FUNCTIONS = ('reverse_vtu_wallet_payment', 'reverse_wallet_redemption',
                  'cancel_order_as_merchant')
# Helpers the real cancel function calls (private schema).
REAL_PRIVATE_FUNCTIONS = ('merchant_cancel_payment_in_flight',
                          'transition_verified_abandoned_captures_for_cancel')
PORT = '55491'
OTHER_MERCHANT = '00000000-0000-4000-8000-0000000000a2'
OWNER = '00000000-0000-4000-8000-0000000000f1'
ORDER = '00000000-0000-4000-8000-0000000000b1'
ORDER_OTHER = '00000000-0000-4000-8000-0000000000b9'
VTU = '00000000-0000-4000-8000-000000000101'
VTU_OTHER = '00000000-0000-4000-8000-000000000109'


def blocks(text):
    """Each `-- [LABEL]` block of the runbook SQL file, keyed by label."""
    found = {}
    for part in re.split(r'^(?=-- \[[A-Z0-9]+\])', text, flags=re.M):
        label = re.match(r'-- \[([A-Z0-9]+)\]', part)
        if label:
            found[label.group(1)] = part
    return found


def swap(sql, old, new):
    if old not in sql:
        raise RuntimeError(f'runbook block no longer contains {old!r}')
    return sql.replace(old, new)


class Checks:
    def __init__(self):
        self.passed = 0
        self.failed = []

    def __call__(self, ok, message):
        print(('PASS ' if ok else 'FAIL ') + message)
        if ok:
            self.passed += 1
        else:
            self.failed.append(message)


class Cluster:
    """A throwaway PostgreSQL cluster on a private Unix socket."""

    def __init__(self, pg_bin, workdir, sock):
        self.bin, self.workdir, self.sock, self.count = pg_bin, workdir, sock, 0
        self.data = workdir / 'data'

    def start(self):
        # macOS refuses to start the postmaster without a valid locale in the environment.
        env = {**os.environ, 'LC_ALL': 'C'}
        subprocess.run([str(self.bin / 'initdb'), '-D', str(self.data), '-U', 'postgres',
                        '--auth=trust', '--no-locale', '-E', 'UTF8'], env=env,
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started = subprocess.run([str(self.bin / 'pg_ctl'), '-D', str(self.data),
                                  '-l', str(self.workdir / 'server.log'),
                                  '-o', f"-h '' -k {self.sock} -p {PORT} -c fsync=off"
                                        ' -c synchronous_commit=off -c full_page_writes=off',
                                  '-w', 'start'],
                                 env=env, stdout=subprocess.DEVNULL)
        if started.returncode:
            raise RuntimeError((self.workdir / 'server.log').read_text(encoding='utf-8'))

    def stop(self):
        subprocess.run([str(self.bin / 'pg_ctl'), '-D', str(self.data), '-m', 'fast', '-w',
                        'stop'], check=False, stdout=subprocess.DEVNULL)

    def psql(self, db, sql, header=False, stop_on_error=True):
        args = [str(self.bin / 'psql'), '-X', '-q', '-h', str(self.sock), '-p', PORT,
                '-U', 'postgres', '-d', db, '-A', '-F', '|']
        if stop_on_error:
            args += ['-v', 'ON_ERROR_STOP=1']
        if not header:
            args.append('-t')
        run = subprocess.run(args, input=sql, capture_output=True, text=True)
        return run.returncode, run.stdout.strip(), run.stderr.strip()

    def must(self, db, sql):
        rc, out, err = self.psql(db, sql)
        if rc:
            raise RuntimeError(err)
        return out

    def build_template(self):
        setup = '\n'.join([FIXTURE.read_text(encoding='utf-8'),
                           real_trigger('update_vtu_transactions_terminal_at', 'update_vtu_terminal_at'),
                           *(real_function(name, 'private') for name in REAL_PRIVATE_FUNCTIONS),
                           *(real_function(name) for name in REAL_FUNCTIONS),
                           SEED.read_text(encoding='utf-8')])
        self.must('postgres', 'CREATE DATABASE runbook_template')
        self.must('runbook_template', setup)

    def fresh(self):
        self.count += 1
        name = f'runbook_{self.count}'
        self.must('postgres', f'CREATE DATABASE {name} TEMPLATE runbook_template'
                              ' STRATEGY FILE_COPY')
        return name


class Runbook:
    """The runbook blocks plus helpers that run them against one fresh database at a time."""

    def __init__(self, cluster, check, text):
        self.cluster, self.check, self.text = cluster, check, text
        self.blocks = blocks(text)
        self.db = None

    def fresh(self):
        self.db = self.cluster.fresh()
        return self.db

    def sql(self, sql, **options):
        return self.cluster.psql(self.db, sql, **options)

    def block(self, label, **values):
        sql = self.blocks[label]
        for key, value in values.items():
            sql = swap(sql, key, value)
        return sql

    def state(self, vtu=VTU):
        return self.sql(f"""SELECT v.status, coalesce(v.metadata->'opsResolution'->>'outcome', '-'),
          (SELECT available_balance FROM public.customer_wallets w
            WHERE w.customer_id = v.customer_id),
          (SELECT count(*) FROM public.customer_wallet_transactions t WHERE t.source_id = v.id)
          FROM public.vtu_transactions v WHERE v.id = '{vtu}'""")[1]

    def v3_sql(self, apply, outcome, amount='103.00', vtu=VTU, evidence='OPS-TEST-1'):
        sql = self.block('V3', **{'PASTE-VTU-ID': vtu, 'PASTE-OUTCOME': outcome})
        if evidence is not None:
            sql = swap(sql, 'PASTE-OPS-LOG-REF', evidence)
        sql = swap(sql, 'v_amount   numeric := 103.00', f'v_amount   numeric := {amount}')
        if apply:
            sql = swap(sql, 'v_apply    boolean := false', 'v_apply    boolean := true')
        return sql

    def v3(self, *args, **kwargs):
        return self.sql(self.v3_sql(*args, **kwargs))

    def v4(self, vtu=VTU):
        return self.sql(self.block('V4', **{'PASTE-VTU-ID': vtu}))


def read_block_checks(rb):
    check, ids = rb.check, {'PASTE-ORDER-ID': ORDER, 'PASTE-VTU-ID': VTU}
    rb.fresh()
    rc, out, err = rb.sql(rb.blocks['O1'])
    rows = out.splitlines()
    check(rc == 0 and len(rows) == 1 and ORDER in rows[0] and '10000.00' in rows[0],
          f'O1 finds only the stuck order: {out or err}')
    rc, out, err = rb.sql(rb.blocks['V1'])
    rows = out.splitlines()
    check(rc == 0 and len(rows) == 1 and VTU in rows[0] and '103.00' in rows[0],
          f'V1 finds only the Ogabassey airtime: {out or err}')
    rc, out, err = rb.sql(rb.block('V2', **{'PASTE-VTU-ID': VTU}))
    check(rc == 0 and 'REQ-TEST-1' in out and 'VENDOR-TEST-1' in out,
          f'V2 returns vendor references: {out or err}')
    rb.cluster.must(rb.db, f"""INSERT INTO public.orders
      (id, merchant_id, customer_id, order_number, total) VALUES ('{ORDER_OTHER}',
      '{OTHER_MERCHANT}', '00000000-0000-4000-8000-0000000000c3', 'OTH-TEST-1', 100.00)""")
    for label, key, other in [('V2', 'PASTE-VTU-ID', VTU_OTHER),
                              ('V4', 'PASTE-VTU-ID', VTU_OTHER),
                              ('O2', 'PASTE-ORDER-ID', ORDER_OTHER)]:
        rc, out, err = rb.sql(rb.block(label, **{key: other}))
        check(rc == 0 and out == '', f'{label} returns nothing for another merchant: {out or err}')
    for label, columns in [
        ('O2', 'shipping_status|cancelled_by|has_cancelled_at|taken|returned|open_intents|'
               'card_refund_queued|balance_matches_ledger'),
        ('V4', 'status|outcome|debited|returned|refunded|balance_matches_ledger|credits_pending'),
        ('V1', 'vtu_id|status|source|type|amount|vendor|provider_fallback|split_wallet|'
               'split_card|debited|reversed|refunded|created_on'),
    ]:
        sql = rb.blocks[label]
        for key, value in ids.items():
            sql = sql.replace(key, value)
        rc, out, err = rb.sql(sql, header=True)
        header = out.splitlines()[0] if out else ''
        check(header == columns, f'{label} column names match the runbook: {header or err[:120]}')
    for label in ['O2', 'V2', 'V4']:
        rc, _, err = rb.sql(rb.blocks[label])
        check(rc != 0 and 'uuid' in err, f'{label} refuses an unfilled id')

    totals = 'SELECT count(*), sum(available_balance) FROM public.customer_wallets'
    before = rb.state() + rb.sql(totals)[1]
    _, _, err = rb.sql(rb.text, stop_on_error=False)
    check(rb.state() + rb.sql(totals)[1] == before and 'uuid' in err,
          'running the whole SQL file changes nothing')


def order_cancel_checks(rb):
    check = rb.check
    cancel = (f"SET request.jwt.claim.sub = '{OWNER}';"
              f"SELECT public.cancel_order_as_merchant('{ORDER}', NULL);")
    o2 = rb.block('O2', **{'PASTE-ORDER-ID': ORDER})
    rb.fresh()
    rc, out, err = rb.sql(cancel)
    check(rc == 0 and out.splitlines()[-1] == 't', f'real merchant cancel runs: {out or err}')
    rc, out, err = rb.sql(o2)
    check(rc == 0 and out == 'cancelled|merchant|t|10000.00|10000.00|0|0|t',
          f'O2 confirms the cancel: {out or err}')
    rc, out, _ = rb.sql(rb.blocks['O1'])
    check(rc == 0 and out == '', 'O1 is empty after the cancel')
    rc, out, _ = rb.sql(cancel)
    check(rc == 0 and out.splitlines()[-1] == 'f' and rb.sql(o2)[1].split('|')[4] == '10000.00',
          'a second cancel returns nothing more')

    payment = """INSERT INTO public.transactions (merchant_id, order_id, transaction_type, amount,
      currency, status, gateway, gateway_reference) VALUES
      ('00000000-0000-4000-8000-0000000000a1', '{order}', 'payment', 5000.00, 'NGN', '{status}',
       'paystack', '{reference}')"""
    rb.fresh()
    rb.cluster.must(rb.db, payment.format(order=ORDER, status='pending', reference='PSK-TEST-1'))
    rc, out, _ = rb.sql(rb.blocks['O1'])
    check(rc == 0 and out.split('|')[7] == '1', f'O1 shows a payment in flight: {out}')
    rc, _, err = rb.sql(cancel)
    _, o1, _ = rb.sql(rb.blocks['O1'])
    check(rc != 0 and 'payment_capture_in_flight' in err and '10000.00' in o1,
          f'cancel refuses while a payment is in flight and nothing changes: {err[:120]}')

    rb.fresh()
    rb.cluster.must(rb.db, payment.format(order=ORDER, status='completed', reference='PSK-TEST-2'))
    rc, out, _ = rb.sql(rb.blocks['O1'])
    check(rc == 0 and out.split('|')[8] == '1',
          f'O1 shows a completed card payment (stop rule): {out}')


def main():
    pg_bin = pathlib.Path(os.environ.get('PG_BIN') or subprocess.check_output(
        ['pg_config', '--bindir'], text=True).strip())
    check = Checks()
    # A Unix socket path must stay short (about 100 bytes), so the socket gets its own
    # directory under /tmp while the data directory follows TMPDIR.
    short = '/tmp' if os.path.isdir('/tmp') else None
    with tempfile.TemporaryDirectory(prefix='baci-stuck-funds-runbook-') as temp, \
            tempfile.TemporaryDirectory(prefix='rb', dir=short) as sock:
        cluster = Cluster(pg_bin, pathlib.Path(temp), pathlib.Path(sock))
        cluster.start()
        try:
            cluster.build_template()
            rb = Runbook(cluster, check, RUNBOOK_SQL.read_text(encoding='utf-8'))
            missing = [label for label in ['O1', 'O2', 'V1', 'V2', 'V3', 'V4']
                       if label not in rb.blocks]
            check(not missing, f'all runbook blocks present (missing: {missing})')
            check('update_vtu_terminal_at' not in FIXTURE.read_text(encoding='utf-8'),
                  'the terminal_at trigger is loaded from supabase/migrations, not copied into the fixture')
            check(cluster.must('runbook_template', "SELECT count(*) FROM pg_trigger WHERE tgname = "
                               "'update_vtu_transactions_terminal_at' AND NOT tgisinternal").strip() == '1',
                  'the real terminal_at trigger is installed in the fixture database')
            if not missing:
                read_block_checks(rb)
                order_cancel_checks(rb)
                vtu_checks.run(rb)
                ledger_checks.run(rb)
        finally:
            cluster.stop()
    print(f'\n{check.passed} passed, {len(check.failed)} failed')
    return 1 if check.failed else 0


if __name__ == '__main__':
    sys.exit(main())
