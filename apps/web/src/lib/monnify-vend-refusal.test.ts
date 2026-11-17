import { describe, expect, it } from 'vitest';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

describe('isMonnifyKnownVendRefusalText', () => {
  it.each([
    'Monnify API error: 400 Bad Request - Amount must be greater than zero',
    'Monnify API error: 400 Bad Request - Insufficient wallet balance',
    'Insufficient Balance',
    'Insufficient funds',
    'Wallet balance is insufficient',
    'Available funds are insufficient',
    'Account balance is too low',
    'INSUFFICIENT_WALLET_BALANCE',
    'AMOUNT_MUST_BE_GREATER_THAN_ZERO',
  ])('treats "%s" as a refusal that delivered nothing', (text) => {
    expect(isMonnifyKnownVendRefusalText(text)).toBe(true);
  });

  it.each([
    'An unexpected error occurred while processing',
    'Product is currently unavailable',
    'Network not available',
    'Biller is inactive',
    'Balance is sufficient',
    'Monnify business failure',
    'Invalid customer reference',
    'Request failed',
    '',
    null,
    undefined,
  ])('does not treat "%s" as a known refusal', (text) => {
    expect(isMonnifyKnownVendRefusalText(text)).toBe(false);
  });
});
