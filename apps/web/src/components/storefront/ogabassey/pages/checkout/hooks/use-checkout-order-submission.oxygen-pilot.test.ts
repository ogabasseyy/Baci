import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import { createContext } from './checkout-order-submission.test-support';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../prepare-checkout-order-submission', () => ({ prepareCheckoutOrderSubmission: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('rechecks pilot admission before preparing a production Oxygen order', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: false }) });
  vi.stubGlobal('fetch', fetchMock);
  const context = createContext();
  context.payment.session = { ...context.payment.session, method: 'oxygen', wallet: { ...context.payment.session.wallet, amountUsed: 0 } };
  context.resumed.order = null;
  const { result } = renderHook(() => useCheckoutOrderSubmission(context));
  await act(async () => result.current.handlePlaceOrder());
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/payments/oxygen/storefront-availability?merchantId='), expect.any(Object));
  expect(prepareCheckoutOrderSubmission).not.toHaveBeenCalled();
  expect(context.processing.releaseSubmission).toHaveBeenCalled();
});
