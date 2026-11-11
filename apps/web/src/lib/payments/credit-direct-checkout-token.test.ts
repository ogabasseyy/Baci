import { describe, expect, it } from 'vitest';
import {
  CREDIT_DIRECT_RPC_ERROR_FALLBACK,
  resolveCreditDirectRpcError,
} from './credit-direct-checkout-token';

describe('resolveCreditDirectRpcError', () => {
  it.each([
    ['order_not_found', 404, undefined],
    ['credit_direct_disabled', 403, undefined],
    [
      'credit_direct_wallet_attempt_pending',
      409,
      'CREDIT_DIRECT_WALLET_PENDING',
    ],
    [
      'credit_direct_wallet_shipping_unsupported',
      409,
      'CREDIT_DIRECT_WALLET_SHIPPING_UNSUPPORTED',
    ],
    [
      'credit_direct_wallet_reconciliation_required',
      409,
      'CREDIT_DIRECT_WALLET_REVIEW_REQUIRED',
    ],
    [
      'credit_direct_wallet_origin_unverified',
      409,
      'CREDIT_DIRECT_WALLET_REVIEW_REQUIRED',
    ],
    [
      'credit_direct_wallet_retry_required',
      503,
      'CREDIT_DIRECT_WALLET_RETRY_REQUIRED',
    ],
    ['order_not_payable', 409, 'ORDER_NOT_PAYABLE'],
    ['order_amount_changed', 409, 'ORDER_AMOUNT_CHANGED'],
    ['invalid_order_amount', 400, undefined],
    ['amount_out_of_range', 400, undefined],
    ['invalid_session', 400, undefined],
    ['invalid_checkout_token', 409, 'CHECKOUT_TOKEN_INVALID'],
    ['checkout_token_mismatch', 409, 'CHECKOUT_TOKEN_INVALID'],
    ['checkout_token_expired', 409, 'CHECKOUT_TOKEN_EXPIRED'],
    ['checkout_token_already_used', 409, 'CHECKOUT_TOKEN_USED'],
  ])('maps %s to status %d', (code, status, expectedCode) => {
    const mapping = resolveCreditDirectRpcError(code);

    expect(mapping.status).toBe(status);
    expect(mapping.body.code).toBe(expectedCode);
    expect(mapping.body.error.length).toBeGreaterThan(0);
  });

  it('matches even when Postgres prefixes the RAISE message', () => {
    const mapping = resolveCreditDirectRpcError(
      'ERROR: order_not_payable (SQLSTATE P0001)'
    );

    expect(mapping.status).toBe(409);
    expect(mapping.body.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('falls back to an opaque 500 for unknown messages', () => {
    expect(resolveCreditDirectRpcError('something unexpected')).toEqual(
      CREDIT_DIRECT_RPC_ERROR_FALLBACK
    );
  });

  it.each([
    [null],
    [undefined],
    [''],
  ])('falls back to 500 for empty message %s', (message) => {
    expect(resolveCreditDirectRpcError(message)).toEqual(
      CREDIT_DIRECT_RPC_ERROR_FALLBACK
    );
  });

  it('does not cross-match distinct token codes (expired is not "already used")', () => {
    expect(
      resolveCreditDirectRpcError('checkout_token_expired').body.code
    ).toBe('CHECKOUT_TOKEN_EXPIRED');
    expect(
      resolveCreditDirectRpcError('checkout_token_already_used').body.code
    ).toBe('CHECKOUT_TOKEN_USED');
  });

  it('uses a caller-supplied fallback when provided', () => {
    const custom = { status: 502, body: { error: 'custom' } };

    expect(resolveCreditDirectRpcError('unmapped', custom)).toEqual(custom);
  });
});
