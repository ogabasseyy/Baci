import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 'synthetic-no-admin-authority',
}));

import {
  createQuoteReadCapability,
  parseQuoteReadCapability,
  quoteReadCookieName,
} from './quote-session-capability';

it('creates only a bounded read continuation for the exact merchant/session, with no credentials', () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
  const token = createQuoteReadCapability(merchant, 'synthetic-session');
  const p = parseQuoteReadCapability(token);
  expect(p).toMatchObject({
    action: 'read_storefront_shipping_quotes',
    merchant_id: merchant,
    payload_text: JSON.stringify({
      merchant_id: merchant,
      session_id: 'synthetic-session',
    }),
  });
  expect(p?.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(p)).not.toContain('synthetic-no-admin-authority');
  expect(quoteReadCookieName(merchant)).toMatch(/^baci_quote_read_/);
  for (const bad of [
    undefined,
    'bad!',
    'a'.repeat(8193),
    Buffer.from('{}').toString('base64url'),
  ])
    expect(parseQuoteReadCapability(bad)).toBeNull();
});
