import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  beginCartSessionRetirement,
  runCartSessionWrite,
} from './cart-session-write-fence';

import { linkAccountCart } from './shared-cart-account-link-client';

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithCsrf);
const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
function snapshot() {
  return {
    cartId,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId,
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 3,
  };
}
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}
beforeEach(() => {
  fetchMock.mockReset();
});

describe('shared-cart account-link client', () => {
  it('posts an explicit account choice with its stable operation id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ cart: snapshot(), replayed: false })
    );
    const input = { choice: 'keep_current' as const, operationId: 'op-1' };
    await expect(linkAccountCart(input, 'shop')).resolves.toMatchObject({
      ok: true,
      replayed: false,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(input);
  });

  it('keeps a lost link response retryable for same-operation replay', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      linkAccountCart({ choice: 'keep_current', operationId: 'op-1' }, 'shop')
    ).resolves.toMatchObject({ ok: false, retryable: true });
  });
});

it('waits for an initial create before installing the explicitly selected account cart', async () => {
  let finish!: () => void;
  const initial = runCartSessionWrite(
    'shop',
    false,
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  fetchMock.mockResolvedValue(jsonResponse({ cart: snapshot() }));
  const selection = linkAccountCart(
    { choice: 'use_saved', operationId: 'select' },
    'shop'
  );
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(
    runCartSessionWrite('shop', false, async () => true)
  ).resolves.toBe(false);
  finish();
  await initial;
  await selection;
  expect(fetchMock).toHaveBeenCalledOnce();
});
it('keeps an in-flight account selection inside a subsequent logout drain', async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const selection = linkAccountCart(
    { choice: 'use_saved', operationId: 'select' },
    'shop'
  );
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const retirement = beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(drained).not.toHaveBeenCalled();
  finish(jsonResponse({ cart: snapshot() }));
  await selection;
  await retirement.drained;
  expect(drained).toHaveBeenCalledOnce();
  retirement.release();
});
