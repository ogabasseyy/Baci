import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsInstallDiagnostic } from './hosted-savings-install-diagnostic';

test('extracts only SQLSTATE and input line without query or payload text', () => {
  assert.deepEqual(
    hostedSavingsInstallDiagnostic(
      'psql:<stdin>:123: ERROR:  42704\nDETAIL: secret query and token'
    ),
    { sqlstate: '42704', line: 123 }
  );
  assert.deepEqual(hostedSavingsInstallDiagnostic('FATAL:  28P01'), {
    sqlstate: '28P01',
  });
  assert.deepEqual(
    hostedSavingsInstallDiagnostic('secret SQLSTATE=42704 LINE=99'),
    {}
  );
});

test('retains redacted process failure without inventing SQLSTATE for termination', () => {
  assert.deepEqual(
    hostedSavingsInstallDiagnostic(
      'Installer command failed SIGNAL=SIGTERM; output redacted'
    ),
    { signal: 'SIGTERM' }
  );
  assert.deepEqual(
    hostedSavingsInstallDiagnostic(
      'Installer command failed SQLSTATE=42704 LINE=123 EXIT=3; output redacted'
    ),
    { sqlstate: '42704', line: 123, exitCode: 3 }
  );
});

test('retains observed wrong-object-type SQLSTATE without leaking relation or statement details', () => {
  assert.deepEqual(
    hostedSavingsInstallDiagnostic(
      'psql:<stdin>:409: ERROR:  42809\nDETAIL: private relation and statement payload'
    ),
    { sqlstate: '42809', line: 409 }
  );
});
