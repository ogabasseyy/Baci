import { expect, it, vi } from 'vitest';
import { withGuestCredentialFallback } from './guest-credential-fallback';

const add = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 1,
  cartCredential: 'A'.repeat(43),
  expectedVersion: 4,
  operationId: 'add-item',
  startFreshIfUnavailable: true as const,
};
type CartEdit = Omit<typeof add, 'cartCredential' | 'startFreshIfUnavailable'> & {
  cartCredential?: string;
  startFreshIfUnavailable?: true;
};

const unavailable = { structuredContent: { success: false, cart_expired: true } };
const uncertain = { structuredContent: { success: false, retryable: true } };
const saved = { structuredContent: { success: true } };

it.each([
  { reason: 'fallback is disabled', enabled: false, edit: add },
  {
    reason: 'the request did not opt in',
    enabled: true,
    edit: { ...add, startFreshIfUnavailable: undefined },
  },
  {
    reason: 'the request removes a product',
    enabled: true,
    edit: { ...add, quantity: 0 },
  },
])('returns expiry without creating a cart when $reason', async ({ enabled, edit }) => {
  const save = vi.fn(async (_input: CartEdit) => unavailable);

  await expect(withGuestCredentialFallback(enabled, save)(edit)).resolves.toEqual(unavailable);
  expect(save.mock.calls).toEqual([[edit]]);
});

it('retries a definitively expired add once as a fresh cart', async () => {
  const save = vi.fn(async (_input: CartEdit) => saved).mockResolvedValueOnce(unavailable);

  await expect(withGuestCredentialFallback(true, save)(add)).resolves.toEqual(saved);
  expect(save.mock.calls).toEqual([
    [add],
    [{ ...add, cartCredential: undefined, expectedVersion: undefined }],
  ]);
});

it('starts fresh on an opted-in add without a credential and drops the old version', async () => {
  const save = vi.fn(async (_input: CartEdit) => saved);
  const edit = { ...add, cartCredential: undefined };

  await expect(withGuestCredentialFallback(true, save)(edit)).resolves.toEqual(saved);
  expect(save.mock.calls).toEqual([[{ ...edit, expectedVersion: undefined }]]);
});

it.each([
  { outcome: 'an uncertain write', reply: uncertain },
  { outcome: 'a successful write', reply: saved },
])('preserves $outcome without attempting replacement', async ({ reply }) => {
  const save = vi.fn(async (_input: CartEdit) => reply);

  await expect(withGuestCredentialFallback(true, save)(add)).resolves.toEqual(reply);
  expect(save.mock.calls).toEqual([[add]]);
});
