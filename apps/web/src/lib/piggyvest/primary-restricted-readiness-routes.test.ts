import { expect, it, vi } from 'vitest';
import { inspectPrimaryRestrictedReadiness } from './primary-restricted-readiness';
import { primaryReadinessFixture } from './primary-restricted-readiness.test-support';

vi.mock('server-only', () => ({}));
const now = new Date('2026-10-07T12:30:00Z');
type Fixture = ReturnType<typeof primaryReadinessFixture>;

function blocked(fixture: Fixture, gate?: string) {
  const report = inspectPrimaryRestrictedReadiness(fixture, now);
  expect(report.status).toBe('blocked');
  if (gate) expect(report.checks).toContainEqual({ gate, passed: false });
}

it.each([
  [
    'missing PATCH',
    (fixture: Fixture) => {
      fixture.routes.pop();
    },
  ],
  [
    'duplicated POST',
    (fixture: Fixture) => {
      fixture.routes[3] = { ...fixture.routes[2] };
    },
  ],
  [
    'legacy path',
    (fixture: Fixture) => {
      fixture.routes[0].path = '/api/storefront/customer/wallet';
    },
  ],
  [
    'wrong handler',
    (fixture: Fixture) => {
      fixture.routes[0].handlerModule = 'legacy-handler';
    },
  ],
  [
    'wrong artifact',
    (fixture: Fixture) => {
      fixture.routes[0].artifactDigest = 'b'.repeat(64);
    },
  ],
  [
    'wrong app origin',
    (fixture: Fixture) => {
      fixture.routes[0].applicationOrigin = 'https://other.example.com';
    },
  ],
  [
    'redirect',
    (fixture: Fixture) => {
      fixture.routes[0].status = 302;
    },
  ],
  [
    'successful financial dispatch',
    (fixture: Fixture) => {
      fixture.routes[1].status = 202;
    },
  ],
  [
    'future route capture',
    (fixture: Fixture) => {
      fixture.routes[0].observedAt = '2026-10-07T12:01:00Z';
    },
  ],
  [
    'stale route capture',
    (fixture: Fixture) => {
      fixture.routes[0].observedAt = '2026-10-07T10:00:00Z';
    },
  ],
] as const)('requires safe artifact-bound route evidence: %s', (_name, mutate) => {
  const fixture = primaryReadinessFixture();
  mutate(fixture);
  blocked(fixture);
});
it.each([
  'authentication',
  'csrf',
  'exactOwnership',
  'singleDispatch',
  'immutableInterestChoice',
  'providerOrigin',
] as const)('requires artifact regression evidence %s because a 401 probe alone is insufficient', (field) => {
  const fixture = primaryReadinessFixture();
  fixture.regressionEvidence[field] = false;
  blocked(fixture, 'artifact_regressions');
});
it.each([
  ['future evidence', '2026-10-07T12:31:00Z', '2026-10-07T13:00:00Z'],
  ['stale evidence', '2026-10-07T10:00:00Z', '2026-10-07T13:00:00Z'],
  ['overlong approval', '2026-10-07T12:00:00Z', '2026-10-09T12:00:00Z'],
] as const)('blocks %s', (_name, capturedAt, expiresAt) => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture, { capturedAt, expiresAt });
  blocked(fixture, 'evidence_window');
});
it('rejects invalid evaluation time and does not turn supplied operator metadata into remote verification', () => {
  const fixture = primaryReadinessFixture();
  fixture.source = 'operator_inventory';
  expect(
    inspectPrimaryRestrictedReadiness(fixture, new Date('invalid')).status
  ).toBe('blocked');
  expect(inspectPrimaryRestrictedReadiness(fixture, now).remoteVerified).toBe(
    false
  );
});
it('never echoes scope values or injected secret fields in its report', () => {
  const fixture = primaryReadinessFixture();
  expect(
    JSON.stringify(inspectPrimaryRestrictedReadiness(fixture, now))
  ).not.toContain(fixture.configuration.businessId);
  const secret = 'sensitive-value-must-not-escape';
  const report = inspectPrimaryRestrictedReadiness(
    { ...fixture, password: secret },
    now
  );
  expect(report.status).toBe('blocked');
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.checks).toEqual([
    { gate: 'inventory_contract', passed: false },
  ]);
});
