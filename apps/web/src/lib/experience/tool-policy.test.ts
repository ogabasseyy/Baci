import { expect, it } from 'vitest';
import { experienceToolPolicy } from './tool-policy';

it('requires publication scope for both public pointer intents', () => {
  for (const name of ['publish_experience', 'rollback_experience'] as const) {
    const policy = experienceToolPolicy[name];
    expect(policy.scopes).toEqual(['storefront.read', 'storefront.publish']);
    expect(policy.securitySchemes).toEqual([
      { type: 'oauth2', scopes: policy.scopes },
    ]);
    expect(policy.annotations.readOnlyHint).toBe(false);
    expect(policy.annotations.idempotentHint).toBe(false);
  }
});

it('treats source adoption and preview capture as write operations', () => {
  for (const name of ['read_experience', 'preview_experience'] as const) {
    expect(experienceToolPolicy[name].scopes).toEqual([
      'storefront.read',
      'storefront.write',
    ]);
    expect(experienceToolPolicy[name].annotations.readOnlyHint).toBe(false);
  }
  expect(experienceToolPolicy.read_experience_evidence.scopes).toEqual([
    'storefront.read',
  ]);
  expect(
    experienceToolPolicy.read_experience_evidence.annotations.readOnlyHint
  ).toBe(true);
});
