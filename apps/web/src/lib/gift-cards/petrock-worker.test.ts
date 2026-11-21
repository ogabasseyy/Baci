import { expect, it, vi } from 'vitest';
import { runGiftCardWorker } from './petrock-worker';

const paid = {
  id: 'quote-1',
  productId: '2844',
  amountKobo: 1673573,
  status: 'paid' as const,
};
const setup = () => ({
  claim: vi.fn().mockResolvedValue(paid),
  read: vi.fn().mockResolvedValue(paid),
  recordSubmission: vi.fn(),
  recordResult: vi.fn(),
  verifySupplierPrice: vi.fn().mockResolvedValue(true),
  submit: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { orderUuid: 'supplier-1' } }),
  poll: vi.fn(),
  seal: vi.fn().mockReturnValue('ciphertext'),
});

it('uses one durable submission claim across concurrent attempts and retains an unknown outcome', async () => {
  const deps = setup();
  deps.claim.mockResolvedValueOnce(paid).mockResolvedValue(null);
  deps.submit.mockRejectedValue(new Error('connection reset'));
  await Promise.all([
    runGiftCardWorker({ mode: 'submit', orderId: paid.id }, deps),
    runGiftCardWorker({ mode: 'submit', orderId: paid.id }, deps),
  ]);
  expect(deps.submit).toHaveBeenCalledExactlyOnceWith(paid);
  expect(deps.recordSubmission).toHaveBeenCalledExactlyOnceWith(paid.id, null);
});

it('skips wallet-order claim and supplier placement when the cost cannot be verified', async () => {
  const deps = setup();
  deps.read.mockResolvedValue(paid);
  deps.verifySupplierPrice.mockResolvedValue(false);
  expect(
    await runGiftCardWorker({ mode: 'submit', orderId: paid.id }, deps)
  ).toEqual({ status: 'price_unverified' });
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.submit).not.toHaveBeenCalled();
});

it('captures a verified terminal replay encrypted and returns only redacted metadata', async () => {
  const deps = setup();
  deps.read.mockResolvedValue({
    ...paid,
    status: 'submitted',
    providerOrderId: 'supplier-1',
  });
  deps.poll.mockResolvedValue({
    ok: true,
    data: {
      orderUuid: 'supplier-1',
      referenceId: paid.id,
      status: 'success',
      replay: 'SECRET-VOUCHER',
    },
  });
  const result = await runGiftCardWorker(
    { mode: 'poll', orderId: paid.id },
    deps
  );
  expect(result).toEqual({
    status: 'captured',
    providerStatus: 'success',
    replay: '[redacted]',
  });
  expect(deps.seal).toHaveBeenCalledExactlyOnceWith('SECRET-VOUCHER', paid.id);
  expect(deps.recordResult).toHaveBeenCalledExactlyOnceWith(
    paid.id,
    'supplier-1',
    'success',
    'ciphertext'
  );
  expect(JSON.stringify(result)).not.toContain('SECRET-VOUCHER');
});
