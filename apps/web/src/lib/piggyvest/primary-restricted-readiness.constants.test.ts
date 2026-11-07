import { describe, expect, it } from 'vitest';
import { PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES } from '@/schemas/piggyvest-primary-wallet-capability';
import { primaryRestrictedReadinessRequirements } from './primary-restricted-readiness.constants';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import { PRIMARY_WALLET_VERIFICATION_STATEMENT } from './primary-wallet-verification';

describe('primaryRestrictedReadinessRequirements', () => {
  it('pins the reviewed evidence and approval windows', () => {
    expect(
      primaryRestrictedReadinessRequirements.maxEvidenceAgeMs
    ).toBeGreaterThan(0);
    expect(
      primaryRestrictedReadinessRequirements.maxApprovalWindowMs
    ).toBeGreaterThan(primaryRestrictedReadinessRequirements.maxEvidenceAgeMs);
  });

  it('requires a unique non-empty environment contract', () => {
    const variables =
      primaryRestrictedReadinessRequirements.environmentVariables;
    expect(variables.length).toBeGreaterThan(0);
    expect(new Set(variables).size).toBe(variables.length);
    for (const variable of variables)
      expect(variable.startsWith('PIGGYVEST_PRIMARY_')).toBe(true);
  });

  it('requires both client build floors the capability gate reads', () => {
    const variables: readonly string[] =
      primaryRestrictedReadinessRequirements.environmentVariables;
    for (const variable of Object.values(
      PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES
    ))
      expect(variables).toContain(variable);
  });

  it('grants the onboarding role its scoped rollout cohort reader', () => {
    const onboarding: readonly string[] =
      primaryRestrictedReadinessRequirements.capabilities.find(
        (capability) => capability.gate === 'onboarding_role'
      )?.functions ?? [];
    expect(onboarding).toContain(
      'piggyvest_primary.read_rollout_cohort_membership(jsonb)'
    );
    const provisioning: readonly string[] =
      primaryRestrictedReadinessRequirements.capabilities.find(
        (capability) => capability.gate === 'provisioning_role'
      )?.functions ?? [];
    expect(provisioning.join('\n')).not.toContain('rollout_cohort');
  });

  it('declares least-privilege capability gates', () => {
    for (const capability of primaryRestrictedReadinessRequirements.capabilities) {
      expect(capability.functions.length).toBeGreaterThan(0);
      for (const fn of capability.functions)
        expect(fn.startsWith('piggyvest_primary.')).toBe(true);
    }
  });

  it('lists every function the onboarding runtime calls in the onboarding role gate', () => {
    const onboarding =
      primaryRestrictedReadinessRequirements.capabilities.find(
        (capability) => capability.gate === 'onboarding_role'
      )?.functions ?? [];
    const called = [
      ...Object.values(PRIMARY_WALLET_STATEMENTS),
      PRIMARY_WALLET_VERIFICATION_STATEMENT,
    ].map((statement) => /piggyvest_primary\.(\w+)\(/.exec(statement)?.[1]);
    for (const name of called)
      expect(
        onboarding.some((signature) =>
          signature.startsWith(`piggyvest_primary.${name}(`)
        )
      ).toBe(true);
  });

  it('binds readiness routes to reviewed handlers', () => {
    expect(primaryRestrictedReadinessRequirements.routes).toEqual([
      {
        path: '/api/storefront/customer/wallet/piggyvest-primary',
        methods: ['GET', 'POST'],
        handler:
          'apps/web/src/app/api/storefront/customer/wallet/piggyvest-primary/route.ts',
      },
      {
        path: '/api/storefront/customer/savings/primary-provisioning',
        methods: ['POST', 'PATCH'],
        handler:
          'apps/web/src/app/api/storefront/customer/savings/primary-provisioning/route.ts',
      },
    ]);
  });
});
