import { afterEach, expect, it, vi } from 'vitest';
import { getGiftCardPilotConfig } from './pilot-wallet-config';

afterEach(() => vi.unstubAllEnvs());

it('requires explicit opt-in and derives a separate presentation key', () => {
  const quoteKey = 'fixture'.repeat(6);
  const orderId = '50000000-0000-4000-8000-000000000001';
  vi.stubEnv('OGABASSEY_GIFT_CARD_PILOT', 'false');
  vi.stubEnv('GIFT_CARD_PILOT_USER_ID', '10000000-0000-4000-8000-000000000001');
  vi.stubEnv('GIFT_CARD_PILOT_ORDER_ID', orderId);
  vi.stubEnv('GIFT_CARD_WALLET_QUOTE_HMAC', quoteKey);
  expect(getGiftCardPilotConfig()).toBeNull();

  vi.stubEnv('OGABASSEY_GIFT_CARD_PILOT', 'true');
  const config = getGiftCardPilotConfig();
  expect(config?.orderId).toBe(orderId);
  expect(config?.presentationKey).toMatch(/^[a-f0-9]{64}$/);
  expect(config?.presentationKey).not.toBe(quoteKey);
});
