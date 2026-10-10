import { expect, it } from 'vitest';
import { piggyvestPrimarySavingsRuntimeSchema } from './piggyvest-primary-savings-runtime';

it('accepts only the restricted authorizer and rejects evidence or provisioning credentials', () => {
  const input = {
    integrationId: '11111111-1111-4111-8111-111111111111',
    environment: 'staging',
    database: {
      host: 'db.example.com',
      port: 5432,
      name: 'postgres',
      login: 'baci_piggyvest_primary_authorizer',
      password: 'test-only',
      certificateAuthority: 'test-ca',
    },
  };
  expect(piggyvestPrimarySavingsRuntimeSchema.safeParse(input).success).toBe(
    true
  );
  for (const login of [
    'postgres',
    'baci_piggyvest_primary_evidence',
    'baci_piggyvest_primary_provisioner',
  ])
    expect(
      piggyvestPrimarySavingsRuntimeSchema.safeParse({
        ...input,
        database: { ...input.database, login },
      }).success
    ).toBe(false);
});
