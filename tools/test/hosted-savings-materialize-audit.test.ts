import assert from 'node:assert/strict';
import test from 'node:test';
import { auditHostedSavingsSql } from './hosted-savings-materialize-audit';

test('reports external effects, roles and managed schemas without echoing SQL or secrets', () => {
  const findings = auditHostedSavingsSql(
    "SELECT net.http_post('https://private.invalid/secret');\nALTER ROLE authenticated;\nALTER TABLE auth.users;\nSELECT cron.schedule('job');"
  );
  assert.ok(
    findings.some(
      (finding) => finding.category === 'externalEffects' && finding.line === 1
    )
  );
  assert.ok(
    findings.some(
      (finding) => finding.category === 'roles' && finding.line === 2
    )
  );
  assert.ok(
    findings.some(
      (finding) => finding.category === 'managedSchemas' && finding.line === 3
    )
  );
  assert.ok(findings.some((finding) => finding.category === 'scheduling'));
  assert.doesNotMatch(JSON.stringify(findings), /private\.invalid|\/secret/);
});

test('does not flag simple SQL and flags psql execution directives', () => {
  assert.deepEqual(auditHostedSavingsSql('SELECT 1;'), []);
  assert.deepEqual(auditHostedSavingsSql('\\! command'), [
    { category: 'psqlCommand', line: 1 },
  ]);
});
