import { expect, it, vi } from 'vitest';
import { recoverRedvaultUncertainAttempt } from '../handlers/recover-redvault-uncertain-attempt';
import { readRedvaultUncertainAttempt } from '../redvault-uncertain-attempt';
import { beginCheckoutOrderSubmission } from './begin-checkout-order-submission';
import { createContext } from './checkout-order-submission.test-support';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../redvault-uncertain-attempt', () => ({
  readRedvaultUncertainAttempt: vi.fn(() => ({ kind: 'pending' })),
}));
vi.mock('../handlers/recover-redvault-uncertain-attempt', () => ({
  recoverRedvaultUncertainAttempt: vi.fn(),
}));

it('recovers an uncertain UBA attempt before allowing a fresh order', async () => {
  const context = createContext();
  const snapshot = { orderId: 'existing-order' } as never;
  vi.mocked(recoverRedvaultUncertainAttempt).mockResolvedValue({
    kind: 'recovered',
    snapshot,
  });
  expect(await beginCheckoutOrderSubmission(context)).toBeUndefined();
  expect(readRedvaultUncertainAttempt).toHaveBeenCalled();
  expect(context.order.setPending).toHaveBeenCalledWith(snapshot);
  expect(context.navigation.setCurrentStep).toHaveBeenCalledWith('payment');
  expect(context.processing.releaseSubmission).toHaveBeenCalled();
});

it('blocks a fresh order when the previous attempt is still uncertain', async () => {
  const context = createContext();
  vi.mocked(recoverRedvaultUncertainAttempt).mockResolvedValue({
    kind: 'unavailable',
  });
  expect(await beginCheckoutOrderSubmission(context)).toBeUndefined();
  expect(context.order.setPending).not.toHaveBeenCalled();
  expect(context.processing.releaseSubmission).toHaveBeenCalled();
});
