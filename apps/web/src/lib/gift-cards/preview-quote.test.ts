import { afterEach, expect, it, vi } from 'vitest';
import { getGiftCardPreviewQuote } from './preview-quote';

const { cacheLife, getGiftCardQuote } = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  getGiftCardQuote: vi.fn(),
}));
vi.mock('next/cache', () => ({ cacheLife }));
vi.mock('./quote', () => ({ getGiftCardQuote }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('uses a short preview cache window and keeps the Juicyway key server-side', async () => {
  vi.stubEnv('JUICYWAY_EXCHANGE_RATE_READ_KEY', 'fixture-key');
  getGiftCardQuote.mockResolvedValue(1673573);

  await expect(getGiftCardPreviewQuote(1028, 1000)).resolves.toBe(1673573);
  expect(cacheLife).toHaveBeenCalledWith({
    stale: 30,
    revalidate: 30,
    expire: 60,
  });
  expect(getGiftCardQuote).toHaveBeenCalledWith(1028, 1000, 'fixture-key');
});

it('normalizes supplier errors and reports a redacted diagnostic', async () => {
  vi.stubEnv('JUICYWAY_EXCHANGE_RATE_READ_KEY', 'fixture-key');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  getGiftCardQuote.mockRejectedValue(new Error('private supplier diagnostic'));

  await expect(getGiftCardPreviewQuote(1028, 1000)).rejects.toThrow(
    'Gift card pricing is temporarily unavailable'
  );
  expect(warn.mock.calls).toEqual([
    ['[gift-card-preview] Juicyway quote unavailable'],
  ]);
});
