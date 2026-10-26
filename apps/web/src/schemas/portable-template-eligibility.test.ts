import { describe, expect, it } from 'vitest';
import { merchant } from '../../tools/builder-preview-spike/fixtures';
import { portableIdentitySchema } from './portable-storefront';

describe('explicit portable template eligibility', () => {
  it('accepts an explicitly resolved Puck template', () => {
    expect(
      portableIdentitySchema.safeParse({ ...merchant, template_id: 'puck' })
        .success
    ).toBe(true);
  });
  it.each([
    undefined,
    null,
    '',
    'default',
    'ogabassey',
    'custom',
    'editorial',
  ])('refuses template %j even with valid merchant identity', (template_id) => {
    const identity = {
      id: merchant.id,
      slug: merchant.slug,
      business_name: merchant.business_name,
      currency: merchant.currency,
      ...(template_id === undefined ? {} : { template_id }),
    };
    expect(portableIdentitySchema.safeParse(identity).success).toBe(false);
  });
});
