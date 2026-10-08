import 'server-only';
import { primaryRestrictedReadinessSchema } from '@/schemas/primary-restricted-readiness';
import { primaryRestrictedReadinessRequirements as requirements } from './primary-restricted-readiness.constants';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';

export function inspectPrimaryRestrictedReadiness(input: unknown, now: Date) {
  const checks: { gate: string; passed: boolean }[] = [];
  const parsed = primaryRestrictedReadinessSchema.safeParse(input);
  const report = () => ({
    status: checks.every((check) => check.passed) ? 'prepared' : 'blocked',
    source: parsed.success ? parsed.data.source : 'invalid',
    activationAuthorized: false,
    remoteVerified: false,
    requiredEnvironmentVariables: requirements.environmentVariables,
    checks,
  });
  checks.push({ gate: 'inventory_contract', passed: parsed.success });
  if (!parsed.success) return report();
  const evidence = parsed.data;
  const config = evidence.configuration;
  const time = now.getTime();
  const captured = Date.parse(evidence.capturedAt);
  const expires = Date.parse(evidence.expiresAt);
  checks.push({
    gate: 'evidence_window',
    passed:
      Number.isFinite(time) &&
      captured <= time &&
      time - captured <= requirements.maxEvidenceAgeMs &&
      expires > time &&
      expires - captured <= requirements.maxApprovalWindowMs,
  });
  checks.push({
    gate: 'provider_environment',
    passed:
      (config.deploymentEnvironment === 'production') ===
        (config.environment === 'production') &&
      config.providerOrigin ===
        getPrimaryWalletProviderOrigin(config.environment),
  });
  checks.push({
    gate: 'runtime_configuration',
    passed:
      config.onboardingRuntimeValidated &&
      config.provisioningRuntimeValidated &&
      config.businessBindingVerified,
  });
  const binding = evidence.integration;
  checks.push({
    gate: 'integration_binding',
    passed:
      binding.enabled &&
      binding.integrationId === config.integrationId &&
      binding.merchantId === config.merchantId &&
      binding.businessId === config.businessId &&
      binding.environment === config.environment &&
      binding.executorLogin === requirements.capabilities[0].login,
  });
  const authority = evidence.goalAuthority;
  checks.push({
    gate: 'goal_authority',
    passed:
      authority.enabled &&
      authority.integrationId === config.integrationId &&
      authority.executorLogin === requirements.capabilities[1].login,
  });
  for (const capability of requirements.capabilities) {
    const roles = evidence.roles.filter(
      (role) => role.login === capability.login
    );
    const role = roles[0];
    const group = role?.capabilityGroup;
    checks.push({
      gate: capability.gate,
      passed:
        roles.length === 1 &&
        !!role &&
        !!group &&
        role.canLogin &&
        !role.superuser &&
        !role.bypassRls &&
        !role.createRole &&
        !role.createDatabase &&
        !role.replication &&
        role.memberships.length === 1 &&
        role.memberships[0] === capability.group &&
        group.name === capability.group &&
        !group.canLogin &&
        !group.superuser &&
        !group.bypassRls &&
        !group.createRole &&
        !group.createDatabase &&
        !group.replication &&
        group.memberships.length === 0 &&
        role.validUntil !== null &&
        Date.parse(role.validUntil) > time &&
        Date.parse(role.validUntil) <= expires &&
        role.schemaUsage &&
        !role.directTableAccess &&
        !role.publicFunctionExecution &&
        role.executableFunctions.length === capability.functions.length &&
        capability.functions.every((signature) =>
          role.executableFunctions.includes(signature)
        ) &&
        role.databaseName === config.databaseName &&
        role.databaseHost === config.databaseHost &&
        role.databasePort === config.databasePort &&
        role.sessionUser === capability.login &&
        role.currentUser === capability.login &&
        role.tls &&
        role.certificateVerified &&
        role.hostnameVerified,
    });
  }
  for (const route of requirements.routes) {
    for (const method of route.methods) {
      const routes = evidence.routes.filter(
        (entry) => entry.path === route.path && entry.method === method
      );
      const entry = routes[0];
      const observed = entry ? Date.parse(entry.observedAt) : Number.NaN;
      checks.push({
        gate: `${method} ${route.path}`,
        passed:
          routes.length === 1 &&
          !!entry &&
          entry.handlerModule === route.handler &&
          entry.artifactDigest === config.artifactDigest &&
          entry.status === 401 &&
          entry.applicationOrigin === config.applicationOrigin &&
          observed <= captured &&
          time - observed <= requirements.maxEvidenceAgeMs,
      });
    }
  }
  const regressions = evidence.regressionEvidence;
  checks.push({
    gate: 'artifact_regressions',
    passed:
      regressions.artifactDigest === config.artifactDigest &&
      regressions.authentication &&
      regressions.csrf &&
      regressions.exactOwnership &&
      regressions.singleDispatch &&
      regressions.immutableInterestChoice &&
      regressions.providerOrigin,
  });
  return report();
}
