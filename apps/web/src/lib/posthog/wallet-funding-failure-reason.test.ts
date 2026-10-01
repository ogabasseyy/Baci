import { describe, expect, it } from 'vitest';
import { resolveWalletFundingFailureReason } from './wallet-funding-failure-reason';

describe('resolveWalletFundingFailureReason', () => {
  // Every `CustomerWalletPaymentAccountErrorCode` member, plus the route-level
  // WALLET_DVA_DISABLED rejection.
  it.each([
    'CUSTOMER_NAME_REQUIRED',
    'CUSTOMER_PHONE_REQUIRED',
    'GATEWAY_NOT_CONFIGURED',
    'PAYSTACK_CUSTOMER_ERROR',
    'PAYSTACK_DVA_ERROR',
    'WALLET_DVA_ORDER_ALIAS_CONFLICT',
    'WALLET_DVA_RECEIVER_CONFLICT',
    'WALLET_DVA_STORAGE_ERROR',
    'WALLET_DVA_SUBACCOUNT_CONFLICT',
    'WALLET_DVA_DISABLED',
  ])('passes through the known server code %s', (code) => {
    expect(resolveWalletFundingFailureReason(code)).toBe(code);
  });

  it.each([
    undefined,
    null,
    '',
    'SOMETHING_UNEXPECTED',
    42,
    {},
  ])('collapses an unrecognized code (%s) to other', (code) => {
    expect(resolveWalletFundingFailureReason(code)).toBe('other');
  });

  it.each([
    'network',
    'other',
  ])('never treats the synthetic bucket %s as a server code pass-through source', (bucket) => {
    // They resolve to `other` when arriving as an API code — the caller sets
    // `network` itself for transport failures.
    expect(resolveWalletFundingFailureReason(bucket)).toBe('other');
  });
});
