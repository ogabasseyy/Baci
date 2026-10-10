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
  'superuser',
  'bypassRls',
  'createRole',
  'createDatabase',
  'replication',
] as const)('blocks elevated login or group attribute %s', (field) => {
  const fixture = primaryReadinessFixture();
  fixture.roles[0][field] = true;
  blocked(fixture, 'onboarding_role');
  fixture.roles[0][field] = false;
  fixture.roles[1].capabilityGroup[field] = true;
  blocked(fixture, 'provisioning_role');
});
it.each([
  [
    'extra membership',
    (fixture: Fixture) => {
      fixture.roles[0].memberships.push('service_role');
    },
  ],
  [
    'wrong membership',
    (fixture: Fixture) => {
      fixture.roles[0].memberships = ['piggyvest_staging_provisioner'];
    },
  ],
  [
    'missing membership',
    (fixture: Fixture) => {
      fixture.roles[0].memberships = [];
    },
  ],
  [
    'inherited group capability',
    (fixture: Fixture) => {
      fixture.roles[0].capabilityGroup.memberships = ['service_role'];
    },
  ],
  [
    'login disabled',
    (fixture: Fixture) => {
      fixture.roles[0].canLogin = false;
    },
  ],
  [
    'login-capable group',
    (fixture: Fixture) => {
      fixture.roles[0].capabilityGroup.canLogin = true;
    },
  ],
  [
    'missing schema usage',
    (fixture: Fixture) => {
      fixture.roles[0].schemaUsage = false;
    },
  ],
  [
    'direct table access',
    (fixture: Fixture) => {
      fixture.roles[0].directTableAccess = true;
    },
  ],
  [
    'PUBLIC execution',
    (fixture: Fixture) => {
      fixture.roles[0].publicFunctionExecution = true;
    },
  ],
  [
    'missing verification RPC',
    (fixture: Fixture) => {
      fixture.roles[0].executableFunctions.pop();
    },
  ],
  [
    'additional RPC',
    (fixture: Fixture) => {
      fixture.roles[0].executableFunctions.push(
        'piggyvest_primary.apply_inflow(jsonb)'
      );
    },
  ],
  [
    'duplicate RPC',
    (fixture: Fixture) => {
      fixture.roles[0].executableFunctions[0] =
        fixture.roles[0].executableFunctions[1];
    },
  ],
  [
    'expired password',
    (fixture: Fixture) => {
      fixture.roles[0].validUntil = '2026-10-07T12:30:00Z';
    },
  ],
  [
    'past password validity',
    (fixture: Fixture) => {
      fixture.roles[0].validUntil = '2026-10-07T12:00:00Z';
    },
  ],
  [
    'credential beyond approval',
    (fixture: Fixture) => {
      fixture.roles[0].validUntil = '2026-10-07T13:00:01Z';
    },
  ],
  [
    'unbounded password validity',
    (fixture: Fixture) => {
      fixture.roles[0].validUntil = null;
    },
  ],
] as const)('blocks unsafe onboarding role: %s', (_name, mutate) => {
  const fixture = primaryReadinessFixture();
  mutate(fixture);
  blocked(fixture, 'onboarding_role');
});
it('permits future credential validity shorter than the evidence approval but never longer', () => {
  const fixture = primaryReadinessFixture();
  fixture.roles[0].validUntil = '2026-10-07T12:45:00Z';
  expect(inspectPrimaryRestrictedReadiness(fixture, now).status).toBe(
    'prepared'
  );
  fixture.roles[1].validUntil = '2026-10-07T13:00:01Z';
  blocked(fixture, 'provisioning_role');
});
it.each([
  'tls',
  'certificateVerified',
  'hostnameVerified',
] as const)('requires verified session TLS %s', (field) => {
  const fixture = primaryReadinessFixture();
  fixture.roles[1][field] = false;
  blocked(fixture, 'provisioning_role');
});
it.each([
  ['sessionUser', 'piggyvest_staging_provisioner'],
  ['currentUser', 'service_role'],
  ['databaseName', 'other'],
  ['databaseHost', 'other.example.com'],
  ['databasePort', 6432],
] as const)('blocks mismatched session %s', (field, value) => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture.roles[1], { [field]: value });
  blocked(fixture, 'provisioning_role');
});
