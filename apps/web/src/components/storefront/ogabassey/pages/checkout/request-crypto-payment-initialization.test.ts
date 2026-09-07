import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCryptoPaymentInitialization } from './request-crypto-payment-initialization';

const input = {
  merchantId: 'merchant',
  chain: 'TRX' as const,
  currency: 'USDT' as const,
  orderCurrency: 'NGN',
  pendingOrder: {
    orderId: 'order',
    amount: 100,
    customerEmail: 'qa@example.com',
    customerName: 'QA',
    customerPhone: '+2348034096325',
    billingAddress: {
      line1: '1 Test Road',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'NG',
      zip_code: '100001',
    },
    items: [],
  },
};

afterEach(() => vi.unstubAllGlobals());
describe('crypto checkout request', () => {
  it('keeps pending addresses out of payable instructions with an actionable retry message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, reference: 'ref', crypto_address_pending: true, crypto_payment: { address: '', chain: 'TRX', currency: 'USDT', amount: 322500, crypto_amount: '4.44', confirmation_time: '1-3 minutes' } })));
    await expect(requestCryptoPaymentInitialization(input)).rejects.toThrow('session is unavailable');
  });

  it('handles the observed HTML 502 without a JSON parsing exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<!DOCTYPE html>Bad gateway', { status: 502 })
        )
    );
    await expect(requestCryptoPaymentInitialization(input)).rejects.toThrow(
      'Payment service is temporarily unavailable'
    );
  });
  it('returns the wallet and converted stablecoin amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            success: true,
            reference: 'ref',
            crypto_payment: {
              address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
              amount: 20172100,
              crypto_amount: '154.60',
              chain: 'TRX',
              currency: 'USDT',
              confirmation_time: '1 minute',
            },
          })
        )
    );
    await expect(
      requestCryptoPaymentInitialization(input)
    ).resolves.toMatchObject({
      address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
      amount: 154.6,
      orderId: 'order',
    });
  });
  it.each([
    { address: '0xdead_Hvm5dqzjTern89UCeTi4Md', crypto_amount: '154.60' },
    { address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', crypto_amount: undefined },
  ])('rejects unsafe payment instructions: %j', async ({address, crypto_amount}) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      success: true, reference: 'ref', crypto_payment: {
        address, crypto_amount, amount: 20172100, chain: 'TRX', currency: 'USDT',
        confirmation_time: '1-3 minutes',
      },
    })));
    await expect(requestCryptoPaymentInitialization(input)).rejects.toThrow('Crypto payment details are unavailable');
  });

  it('rejects a valid address when the chain or currency does not match the selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          success: true,
          reference: 'ref',
          crypto_payment: {
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            amount: 20172100,
            crypto_amount: '154.60',
            chain: 'ETH',
            currency: 'USDC',
            confirmation_time: '1-3 minutes',
          },
        })
      )
    );
    await expect(requestCryptoPaymentInitialization(input)).rejects.toThrow(
      'Crypto payment network does not match the selected network.'
    );
  });

});
