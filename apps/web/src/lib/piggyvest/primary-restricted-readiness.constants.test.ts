import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { primaryRestrictedReadinessRequirements } from './primary-restricted-readiness.constants';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import { PRIMARY_WALLET_VERIFICATION_STATEMENT } from './primary-wallet-verification';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations'
);

// Every piggyvest_primary function the migrations grant to a group, with
// whitespace removed so signatures compare exactly.
function migrationGrantsTo(group: string): string[] {
  const grants = new Set<string>();
  const statement =
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]*?)\s+TO\s+([^;]+);/gi;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.endsWith('.sql')
  )) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(
      /--[^\n]*/g,
      ''
    );
    for (const [, functions, grantees] of sql.matchAll(statement)) {
      if (!grantees.split(',').some((grantee) => grantee.trim() === group))
        continue;
      let depth = 0;
      let current = '';
      for (const char of `${functions},`) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
          const signature = current.replace(/\s+/g, '');
          if (signature.startsWith('piggyvest_primary.')) grants.add(signature);
          current = '';
        } else current += char;
      }
    }
  }
  return [...grants].sort();
}

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

  it('matches the onboarding role gate to exactly what the migrations grant its group', () => {
    // Arrange
    const onboarding = primaryRestrictedReadinessRequirements.capabilities.find(
      (capability) => capability.gate === 'onboarding_role'
    );

    // Act
    const granted = migrationGrantsTo(onboarding?.group ?? '');

    // Assert: readiness requires an exact match, so a new grant must be listed.
    expect(granted).toContain('piggyvest_primary.is_backed(uuid,uuid)');
    expect([...(onboarding?.functions ?? [])].sort()).toEqual(granted);
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
