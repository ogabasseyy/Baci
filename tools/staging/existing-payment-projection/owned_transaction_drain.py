"""Observe one already-owned RW transaction; no transaction or financial writes.

Bind after start_sql() assigns its transaction ID. Verify on that same transport
at the commit boundary. Any failure revokes this instance; the parent must
rollback/close, not retry. The drain does not replace locks or stopped writers.
"""

import json
import re


SYSTEM = '7685292944002592802'
DEADLINE = '2026-10-06T15:59:10Z'
DRAIN_SQL = f"""
DO $owned_drain$
BEGIN
  PERFORM pg_catalog.pg_stat_clear_snapshot();
  IF session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres'
    OR pg_catalog.current_database() IS DISTINCT FROM 'postgres'
    OR pg_catalog.inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
       IS DISTINCT FROM '{SYSTEM}'
    OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) IS DISTINCT FROM true
    OR (SELECT usename FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid())
       IS DISTINCT FROM 'postgres'
    OR pg_catalog.current_setting('session_replication_role') IS DISTINCT FROM 'origin'
    OR pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'
    OR pg_catalog.current_setting('transaction_read_only') IS DISTINCT FROM 'off'
    OR pg_catalog.current_setting('search_path') IS DISTINCT FROM 'pg_catalog'
    OR pg_catalog.current_setting('standard_conforming_strings') IS DISTINCT FROM 'on'
    OR pg_catalog.pg_current_xact_id_if_assigned() IS NULL
    OR pg_catalog.clock_timestamp()>='{DEADLINE}'::timestamptz
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE pid<>pg_catalog.pg_backend_pid() AND backend_type='client backend'
        AND xact_start IS NOT NULL) THEN
    RAISE EXCEPTION 'owned transaction drain refused' USING ERRCODE='42501';
  END IF;
END $owned_drain$;
SELECT pg_catalog.jsonb_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'sessionUser',session_user,'currentUser',current_user,
  'database',pg_catalog.current_database(),
  'localUnix',pg_catalog.inet_client_addr() IS NULL,
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
  'readWrite',pg_catalog.current_setting('transaction_read_only')='off',
  'backendPid',pg_catalog.pg_backend_pid(),
  'transactionId',pg_catalog.pg_current_xact_id_if_assigned()::text,
  'preparedTransactions',(SELECT count(*) FROM pg_catalog.pg_prepared_xacts),
  'otherClientTransactions',(SELECT count(*) FROM pg_catalog.pg_stat_activity
    WHERE pid<>pg_catalog.pg_backend_pid() AND backend_type='client backend'
      AND xact_start IS NOT NULL));
"""
EXPECTED = dict(systemIdentifier=SYSTEM, sessionUser='postgres', currentUser='postgres',
                database='postgres', localUnix=True, readOnly=False, readWrite=True,
                preparedTransactions=0, otherClientTransactions=0)


def _require(condition):
    if not condition:
        raise ValueError('owned_transaction_drain_refused')


def _decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result)
            result[key] = value
        return result
    _require(type(raw) is str and 0 < len(raw.encode('utf-8')) <= 8192)
    report = json.loads(raw, object_pairs_hook=unique,
                        parse_constant=lambda value: _require(False))
    _require(type(report) is dict and set(report) == set(EXPECTED) | {'backendPid', 'transactionId'})
    for key, value in EXPECTED.items():
        _require(type(report[key]) is type(value) and report[key] == value)
    _require(type(report['backendPid']) is int and 0 < report['backendPid'] <= 2147483647)
    xid = report['transactionId']
    _require(type(xid) is str and re.fullmatch('[1-9][0-9]{0,19}', xid) is not None
             and int(xid) <= 18446744073709551615)
    return report


class OwnedTransactionDrain:
    def __init__(self, transaction):
        self._transaction = transaction
        self._valid = False
        self._baseline = self._collect()
        self._valid = True

    @property
    def baseline(self):
        return dict(self._baseline)

    def _collect(self):
        try:
            records = self._transaction.execute(DRAIN_SQL)
            _require(type(records) is list and len(records) == 1)
            return _decode(records[0])
        except Exception:
            raise ValueError('owned_transaction_drain_refused') from None

    def verify(self):
        try:
            _require(self._valid)
            observed = self._collect()
            _require(observed == self._baseline)
            return observed
        except Exception:
            self._valid = False
            raise ValueError('owned_transaction_drain_refused') from None
