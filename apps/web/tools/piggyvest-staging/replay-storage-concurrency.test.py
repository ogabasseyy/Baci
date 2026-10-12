import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


class ReplayStorageConcurrencyTest(unittest.TestCase):
    def test_quarantine_locks_receipt_before_reclaim(self):
        binary = Path(os.environ.get('PVB_TEST_PG_BIN', '/opt/homebrew/opt/postgresql@18/bin'))
        source = Path(__file__).parent
        with tempfile.TemporaryDirectory(prefix='pvb-lock-') as directory:
            root = Path(directory)
            data = root / 'data'
            subprocess.run([str(binary / 'initdb'), '-D', str(data), '-U', 'supabase_admin', '-A', 'trust'], check=True, capture_output=True)
            subprocess.run([str(binary / 'pg_ctl'), '-D', str(data), '-l', str(root / 'server.log'), '-o', f"-k {root} -h ''", '-w', 'start'], check=True, capture_output=True)
            command = [str(binary / 'psql'), '-h', str(root), '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']

            def query(sql):
                return subprocess.run(command, input=sql, text=True, check=True, capture_output=True).stdout.strip()

            try:
                query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator NOINHERIT; REVOKE CREATE ON SCHEMA public FROM PUBLIC;')
                identifier = query('SELECT system_identifier FROM pg_control_system();')
                for filename in ['ingest-storage.sql', 'replay-storage.sql']:
                    subprocess.run(command + ['-v', f'expected_system_identifier={identifier}'], input=(source / filename).read_text(), text=True, check=True, capture_output=True)
                query((source / 'replay-storage.test.sql').read_text())
                query("SELECT public.accept_piggyvest_staging_receipt(repeat('d',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1');")
                identity = query('SELECT receipt_id::text || \',\' || claim_token::text FROM public.claim_piggyvest_staging_receipts(1,30);').split(',')
                receipt, token = identity
                query(f"UPDATE public.piggyvest_staging_receipts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id='{receipt}';")
                query("""
CREATE FUNCTION public.pause_quarantine_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(9182026);
  RETURN NEW;
END $$;
CREATE TRIGGER pause_quarantine BEFORE INSERT ON public.piggyvest_staging_replay_quarantine
FOR EACH ROW EXECUTE FUNCTION public.pause_quarantine_insert();
""")
                blocker = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                blocker.stdin.write("SELECT pg_advisory_lock(9182026);\n\\echo LOCKED\n")
                blocker.stdin.flush()
                while blocker.stdout.readline().strip() != 'LOCKED':
                    if blocker.poll() is not None:
                        self.fail('Advisory lock holder exited')
                worker = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                worker.stdin.write(f"SELECT public.quarantine_piggyvest_staging_receipt('{receipt}','{token}','synthetic-lock-event','poison',NULL);\n")
                worker.stdin.close()
                waiting = False
                for attempt in range(100):
                    waiting = query("SELECT count(*) FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%quarantine_piggyvest_staging_receipt%';") == '1'
                    if waiting:
                        break
                    time.sleep(0.05)
                self.assertTrue(waiting, 'Quarantine did not reach its locked insert')
                try:
                    count = query('SELECT count(*) FROM public.claim_piggyvest_staging_receipts(1,30);')
                    self.assertEqual(count, '0', 'Reclaimer stole receipt while quarantine was writing')
                finally:
                    blocker.stdin.write('SELECT pg_advisory_unlock(9182026);\n\\q\n')
                    blocker.stdin.flush()
                    blocker.wait(timeout=10)
                    worker.wait(timeout=10)
                    for process in [blocker, worker]:
                        for stream in [process.stdin, process.stdout, process.stderr]:
                            if stream and not stream.closed:
                                stream.close()
                self.assertEqual(worker.returncode, 0)
                self.assertEqual(query(f"SELECT status FROM public.piggyvest_staging_receipts WHERE id='{receipt}';"), 'quarantined')
            finally:
                subprocess.run([str(binary / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
