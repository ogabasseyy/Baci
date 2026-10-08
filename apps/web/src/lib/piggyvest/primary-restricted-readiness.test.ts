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

it('prepares complete synthetic metadata without claiming deployment or authorization', () => {
  const report = inspectPrimaryRestrictedReadiness(
    primaryReadinessFixture(),
    now
  );
  expect(report.status).toBe('prepared');
  expect(report).toMatchObject({
    activationAuthorized: false,
    remoteVerified: false,
    source: 'synthetic',
  });
});
it('blocks expired evidence with an actionable static gate and no input echo', () => {
  const fixture = primaryReadinessFixture();
  fixture.expiresAt = '2026-10-07T12:01:00Z';
  const report = inspectPrimaryRestrictedReadiness(fixture, now);
  expect(report.checks).toContainEqual({
    gate: 'evidence_window',
    passed: false,
  });
  expect(report.status).toBe('blocked');
});
it('does not let the legacy provisioner stand in for the primary login', () => {
  const fixture = primaryReadinessFixture();
  fixture.roles[0].login = 'piggyvest_staging_provisioner';
  const report = inspectPrimaryRestrictedReadiness(fixture, now);
  expect(report.checks).toContainEqual({
    gate: 'onboarding_role',
    passed: false,
  });
});
it('accepts exact production origin only with production deployment and binding', () => {
  const fixture = primaryReadinessFixture();
  fixture.configuration.environment = 'production';
  fixture.configuration.deploymentEnvironment = 'production';
  fixture.configuration.providerOrigin = 'https://api.piggyvest.business';
  fixture.integration.environment = 'production';
  expect(inspectPrimaryRestrictedReadiness(fixture, now).status).toBe(
    'prepared'
  );
});
it.each([
  [
    'staging token pointed at production',
    (fixture: Fixture) => {
      fixture.configuration.providerOrigin = 'https://api.piggyvest.business';
    },
  ],
  [
    'production deployment with staging',
    (fixture: Fixture) => {
      fixture.configuration.deploymentEnvironment = 'production';
    },
  ],
  [
    'preview deployment with production',
    (fixture: Fixture) => {
      fixture.configuration.environment = 'production';
      fixture.configuration.providerOrigin = 'https://api.piggyvest.business';
    },
  ],
  [
    'alternate provider hostname',
    (fixture: Fixture) => {
      fixture.configuration.providerOrigin = 'https://caller.example.com';
    },
  ],
] as const)('blocks provider environment mismatch: %s', (_name, mutate) => {
  const fixture = primaryReadinessFixture();
  mutate(fixture);
  blocked(fixture, 'provider_environment');
});
it.each([
  'onboardingRuntimeValidated',
  'provisioningRuntimeValidated',
  'businessBindingVerified',
] as const)('requires configuration evidence %s', (field) => {
  const fixture = primaryReadinessFixture();
  fixture.configuration[field] = false;
  blocked(fixture, 'runtime_configuration');
});
it.each([
  ['merchantId', '00000000-0000-4000-8000-000000000099'],
  ['integrationId', '00000000-0000-4000-8000-000000000099'],
  ['businessId', 'businesswithhyphens'],
  ['environment', 'production'],
  ['executorLogin', 'piggyvest_staging_provisioner'],
  ['enabled', false],
] as const)('requires the exact enabled integration binding %s', (field, value) => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture.integration, { [field]: value });
  blocked(fixture, 'integration_binding');
});
it.each([
  ['integrationId', '00000000-0000-4000-8000-000000000099'],
  ['executorLogin', 'baci_piggyvest_primary_provisioner'],
  ['enabled', false],
] as const)('requires separate goal authority %s', (field, value) => {
  const fixture = primaryReadinessFixture();
  Object.assign(fixture.goalAuthority, { [field]: value });
  blocked(fixture, 'goal_authority');
});
