"""Fixed rehearsal callbacks for a parent-authenticated root runner; no CLI.

run(argv, input=bytes, timeout=60) returns successful stdout bytes,
raises on nonzero exit, and enforces the timeout. read(path, pin) must authenticate
the parent-owned source before returning bytes. Source bootstrap, root authority,
exclusive inventory and all collection orchestration remain owned by the parent.
"""

import hashlib
import json
from pathlib import Path

from cutover_database import SNAPSHOT_SQL


APPLICATION_SQL_PATH = Path('/root/baci-existing-projection-source.btzzmjl9/financial_snapshot.sql')
APPLICATION_SQL_SHA256 = '46fac83a0f1bb499b9d6fd17ebb8714cd72af148f1d5dfa56285eb61584cd7ed'
ROLLBACK_SQL_SHA256 = '315028b8f028f3537dcf2226123a495238f2f85eb6a88855275c25f05078c69d'
APPLICATION_ARGV = ('/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
    '/usr/bin/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres')
RECEIPT_ARGV = ('/usr/bin/docker', 'exec', '-i', 'pvb-staging-receipts-db',
    '/usr/local/bin/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres')
OUTPUT_FORMAT = b'\\set QUIET on\n\\pset format unaligned\n\\pset tuples_only on\n\\unset QUIET\n'
LIMIT = 16000000


class ReplayRehearsalTransport:
    def __init__(self, run, read):
        if not callable(run) or not callable(read):
            raise ValueError('replay_transport_refused')
        self._runner = run
        self._read = read
        self._attempted = False

    @staticmethod
    def _require(condition):
        if not condition:
            raise ValueError('replay_transport_refused')

    def _run(self, argv, raw):
        try:
            self._require(type(raw) is bytes and 0 < len(raw) <= LIMIT)
            output = self._runner(list(argv), input=raw, timeout=60)
            if type(output) is bytes:
                self._require(0 < len(output) <= LIMIT)
                output = output.decode('utf-8')
            self._require(type(output) is str and 0 < len(output.encode('utf-8')) <= LIMIT)
            lines = output.splitlines()
            while lines and lines[-1] == '':
                lines.pop()
            self._require(bool(lines) and lines[-1] == 'ROLLBACK'
                and 'COMMIT' not in lines and lines.count('ROLLBACK') == 1)
            return lines
        except Exception:
            raise ValueError('replay_transport_refused') from None

    def _snapshot(self, argv, raw):
        try:
            self._require(raw.startswith(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n')
                and raw.endswith(b'ROLLBACK;\n'))
            lines = self._run(argv, OUTPUT_FORMAT + raw)
            self._require(lines[0] == 'BEGIN')
            rows = [line for line in lines[1:-1] if line not in ('SET', 'DO')]
            self._require(len(rows) == 1)

            def unique(pairs):
                result = {}
                for key, value in pairs:
                    self._require(key not in result)
                    result[key] = value
                return result

            def invalid_constant(value):
                raise ValueError('replay_transport_refused')

            result = json.loads(rows[0], object_pairs_hook=unique, parse_constant=invalid_constant)
            self._require(type(result) is dict)
            return result
        except Exception:
            raise ValueError('replay_transport_refused') from None

    def query(self, sql):
        self._require(type(sql) is str and sql == SNAPSHOT_SQL)
        return self._snapshot(RECEIPT_ARGV, SNAPSHOT_SQL.encode('utf-8'))

    def execute(self, raw):
        self._require(not self._attempted and type(raw) is bytes and 0 < len(raw) <= LIMIT
            and hashlib.sha256(raw).hexdigest() == ROLLBACK_SQL_SHA256
            and raw.endswith(b'ROLLBACK;\n'))
        self._attempted = True
        self._run(RECEIPT_ARGV, raw)
        return 'ROLLBACK'

    def application_snapshot(self):
        try:
            raw = self._read(APPLICATION_SQL_PATH, APPLICATION_SQL_SHA256)
            self._require(type(raw) is bytes and 0 < len(raw) <= LIMIT
                and hashlib.sha256(raw).hexdigest() == APPLICATION_SQL_SHA256)
            return self._snapshot(APPLICATION_ARGV, raw)
        except Exception:
            raise ValueError('replay_transport_refused') from None
