import { afterEach, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.doUnmock('@/schemas/bank-card-offers');
  vi.resetModules();
});

it('ships without enabling any campaign before bank approval', async () => {
  const { BANK_CARD_OFFERS } = await import('./bank-card-offers');

  expect(BANK_CARD_OFFERS).toEqual([]);
  expect(logger.warn).not.toHaveBeenCalled();
});

it('disables the offer list if validation fails so shared checkout can load', async () => {
  vi.doMock('@/schemas/bank-card-offers', () => ({
    bankCardOffersSchema: { safeParse: () => ({ success: false }) },
  }));

  const { BANK_CARD_OFFERS } = await import('./bank-card-offers');

  expect(BANK_CARD_OFFERS).toEqual([]);
  expect(logger.warn).toHaveBeenCalledWith({
    message: 'Invalid bank card offer configuration; offers disabled',
  });
});
