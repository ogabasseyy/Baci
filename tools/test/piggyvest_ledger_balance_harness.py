import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
PORT = '55483'


class LedgerBalanceHarness:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ledger-balance-', dir='/private/tmp')
        self.path = Path(self.directory.name)
        self.environment = {key: value for key, value in os.environ.items()
                            if not key.startswith('PG')}
        self.started = False
        try:
            self.command([BIN / 'initdb', '-D', self.path / 'data', '-A', 'trust',
                          '-U', 'postgres', '--no-locale', '--encoding=UTF8'])
            self.command([BIN / 'pg_ctl', '-D', self.path / 'data', '-l', self.path / 'log',
                          '-o', f"-k {self.path} -h '' -p {PORT}", '-w', 'start'])
            self.started = True
        except Exception:
            self.close()
            raise

    def command(self, arguments, source=None, checked=True):
        result = subprocess.run(list(map(str, arguments)), input=source, text=True,
                                capture_output=True, env=self.environment, timeout=30)
        if checked and result.returncode:
            raise AssertionError(result.stderr.strip())
        return result

    def sql(self, source, login='postgres', checked=True):
        return self.command([BIN / 'psql', '-XqAt', '-w', '-h', self.path, '-p', PORT,
                             '-U', login, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
                             '-v', 'VERBOSITY=verbose'], source, checked)

    def install(self):
        self.sql((ROOT / 'tools/test/piggyvest-savings-ledger-setup.sql').read_text())
        migrations = sorted((ROOT / 'supabase/migrations').glob('20260912120[0-5]00_*.sql'))
        if len(migrations) != 6:
            raise AssertionError('Exact six canonical ledger migrations required')
        for migration in migrations:
            self.sql(migration.read_text())
        self.sql("""
          CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT NOSUPERUSER
            NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('30000000-0000-4000-8000-000000000001',
             '40000000-0000-4000-8000-000000000001',
             '10000000-0000-4000-8000-000000000001',
             '20000000-0000-4000-8000-000000000001',
             'prefunded_treasury_operator',true);
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb),
            piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid)
            TO prefunded_treasury_operator;
        """)

    def close(self):
        pid_file = self.path / 'data/postmaster.pid'
        if pid_file.exists():
            fields = pid_file.read_text().splitlines()
            if Path(fields[1]).resolve() != (self.path / 'data').resolve():
                raise AssertionError('Refusing cleanup of unrelated PostgreSQL cluster')
            self.command([BIN / 'pg_ctl', '-D', self.path / 'data', '-m', 'fast', '-w', 'stop'])
            if pid_file.exists():
                raise AssertionError('Preserving cluster that did not stop')
        self.directory.cleanup()
