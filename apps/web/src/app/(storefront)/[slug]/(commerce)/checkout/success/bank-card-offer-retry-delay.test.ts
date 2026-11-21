import { expect, it, vi } from 'vitest';
import { bankCardOfferRetryDelay } from './bank-card-offer-retry-delay';

it.each([
  ['45', 45000],
  ['bad', 15_000],
  ['0', 15_000],
  ['1000000000', 300_000],
])('reads a bounded Retry-After of %s', (retryAfter, delay) => {
  const response = new Response(null, {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  });
  expect(bankCardOfferRetryDelay(response)).toBe(delay);
});

it('backs off when rate limited without a Retry-After header', () => {
  expect(bankCardOfferRetryDelay(new Response(null, { status: 429 }))).toBe(
    15_000
  );
});

it('honors an HTTP-date Retry-After only against the server clock', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': 'Fri, 20 Nov 2026 12:01:00 GMT' },
    });
    expect(bankCardOfferRetryDelay(response)).toBe(15_000);
    response.headers.set('Date', 'invalid');
    expect(bankCardOfferRetryDelay(response)).toBe(15_000);
    response.headers.set('Date', 'Fri, 20 Nov 2026 12:00:00 GMT');
    expect(bankCardOfferRetryDelay(response)).toBe(60_000);
    response.headers.set('Retry-After', 'Fri, 20 Nov 2026 11:59:00 GMT');
    expect(bankCardOfferRetryDelay(response)).toBe(15_000);
    response.headers.set('Date', 'Fri, 20 Nov 2026 11:58:30 GMT');
    expect(bankCardOfferRetryDelay(response)).toBe(30_000);
  } finally {
    vi.useRealTimers();
  }
});
