import { describe, expect, it } from 'vitest';
import { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-accounts';
import {
  walletAccountErrorResponse,
  walletAccountErrorStatus,
} from './wallet-funding-account-error';

describe('walletAccountErrorStatus', () => {
  it('maps CUSTOMER_NAME_REQUIRED to 400', () => {
    expect(walletAccountErrorStatus('CUSTOMER_NAME_REQUIRED')).toBe(400);
  });

  it('maps CUSTOMER_PHONE_REQUIRED to 400', () => {
    expect(walletAccountErrorStatus('CUSTOMER_PHONE_REQUIRED')).toBe(400);
  });

  it('maps configuration and DVA conflict codes to 409', () => {
    expect(walletAccountErrorStatus('GATEWAY_NOT_CONFIGURED')).toBe(409);
    expect(walletAccountErrorStatus('WALLET_DVA_ORDER_ALIAS_CONFLICT')).toBe(
      409
    );
    expect(walletAccountErrorStatus('WALLET_DVA_SUBACCOUNT_CONFLICT')).toBe(
      409
    );
  });

  it('maps Paystack upstream failures to 502', () => {
    expect(walletAccountErrorStatus('PAYSTACK_CUSTOMER_ERROR')).toBe(502);
    expect(walletAccountErrorStatus('PAYSTACK_DVA_ERROR')).toBe(502);
  });

  it('falls back to 500 for an unknown code', () => {
    expect(walletAccountErrorStatus('SOMETHING_UNEXPECTED')).toBe(500);
  });
});

describe('walletAccountErrorResponse', () => {
  it('returns the mapped status with the code and message in the body', async () => {
    const error = new CustomerWalletPaymentAccountError(
      'GATEWAY_NOT_CONFIGURED',
      'Gateway is not configured'
    );

    const response = walletAccountErrorResponse(error);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      code: 'GATEWAY_NOT_CONFIGURED',
      error: 'Gateway is not configured',
    });
  });

  it('defaults to a 500 status for an unrecognized error code', () => {
    const error = new CustomerWalletPaymentAccountError(
      'UNKNOWN_CODE' as never,
      'Boom'
    );

    expect(walletAccountErrorResponse(error).status).toBe(500);
  });
});
