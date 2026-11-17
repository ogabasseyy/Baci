import { describe, expect, it } from 'vitest';
import { isMonnifyKnownVendRefusalText } from './monnify-vend-refusal';

describe('isMonnifyKnownVendRefusalText', () => {
  it.each([
    'Monnify API error: 400 Bad Request - Amount must be greater than zero',
    'Monnify API error: 400 Bad Request - Insufficient wallet balance',
    'Insufficient Balance',
    'Insufficient funds',
    'Product is currently unavailable',
    'Network not available',
    'Biller is inactive',
  ])('treats "%s" as a refusal that delivered nothing', (text) => {
    expect(isMonnifyKnownVendRefusalText(text)).toBe(true);
  });

  it.each([
    'An unexpected error occurred while processing',
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
