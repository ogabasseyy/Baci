import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCryptoPayment } from './crypto-checkout-init';

const request = {
  merchantId: 'merchant-1',
  orderId: 'order-1',
  amount: '5000',
  customerEmail: 'a@b.c',
  customerName: 'Ada',
  customerPhone: '0800',
  cryptoChain: 'TRX',
  cryptoCurrency: 'USDT',
  trackingToken: 'tok',
};

function handlers() {
  return {
    setStatus: vi.fn(),
    setErrorMessage: vi.fn(),
    setCryptoData: vi.fn(),
  };
}

describe('initializeCryptoPayment', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('stores the deposit details and becomes ready on success', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        reference: 'REF-1',
        crypto_payment: {
          address: 'addr',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5 min',
          payment_id: 'pay-1',
        },
      })
    );
    const h = handlers();

    await initializeCryptoPayment(request, h);

    expect(h.setStatus).toHaveBeenNthCalledWith(1, 'loading');
    expect(h.setCryptoData).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'addr',
        amount: 5000,
        orderId: 'order-1',
        reference: 'REF-1',
        paymentId: 'pay-1',
        trackingToken: 'tok',
      })
    );
    expect(h.setStatus).toHaveBeenLastCalledWith('ready');
  });

  it('reports the server error when initialization fails', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Nope' }, { status: 400 })
    );
    const h = handlers();

    await initializeCryptoPayment(request, h);

    expect(h.setStatus).toHaveBeenLastCalledWith('error');
    expect(h.setErrorMessage).toHaveBeenLastCalledWith('Nope');
  });

  it('errors when the response has no crypto payment', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    const h = handlers();

    await initializeCryptoPayment(request, h);

    expect(h.setStatus).toHaveBeenLastCalledWith('error');
    expect(h.setErrorMessage).toHaveBeenLastCalledWith(
      'Failed to generate crypto payment address'
    );
  });

  it('errors instead of becoming ready when the response has no payment id', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        reference: 'REF-1',
        crypto_payment: {
          address: 'addr',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5 min',
        },
      })
    );
    const h = handlers();

    await initializeCryptoPayment(request, h);

    expect(h.setCryptoData).not.toHaveBeenCalled();
    expect(h.setStatus).toHaveBeenLastCalledWith('error');
  });

  it('ignores the result of a request that was superseded while pending', async () => {
    let current = true;
    fetchMock.mockImplementation(async () => {
      current = false; // the page moved to another order meanwhile
      return Response.json({
        success: true,
        reference: 'REF-1',
        crypto_payment: {
          address: 'addr',
          chain: 'TRX',
          currency: 'USDT',
          amount: 500000,
          confirmation_time: '5 min',
          payment_id: 'pay-1',
        },
      });
    });
    const h = handlers();

    await initializeCryptoPayment(request, h, () => current);

    expect(h.setCryptoData).not.toHaveBeenCalled();
    expect(h.setStatus).not.toHaveBeenCalledWith('ready');
  });

  it('ignores the failure of a superseded request too', async () => {
    let current = true;
    fetchMock.mockImplementation(async () => {
      current = false;
      return Response.json({ error: 'Late' }, { status: 500 });
    });
    const h = handlers();

    await initializeCryptoPayment(request, h, () => current);

    expect(h.setStatus).not.toHaveBeenCalledWith('error');
    expect(h.setErrorMessage).not.toHaveBeenCalledWith('Late');
  });
});
