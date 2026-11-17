import { describe, expect, it } from 'vitest';
import { isMonnifyVendOutcomeText } from './monnify-vend-outcome';

describe('isMonnifyVendOutcomeText', () => {
  it.each([
    'Service unavailable',
    'Vend request failed',
    'Vend transaction failed: insufficient wallet balance',
    'Vend request has failed',
    'Transaction failed: insufficient wallet balance',
    'Airtime purchase failed: insufficient wallet balance',
    'Payment has failed',
    'Top-up failed',
    'Vend request pending: insufficient wallet balance',
    'Vend is in progress: insufficient funds',
    'Transaction processing',
    'Vend queued',
    'Vend initiated',
    'Failed transaction: insufficient wallet balance',
    'Failed airtime purchase: insufficient wallet balance',
    'Transaction reversed: insufficient wallet balance',
    'transaction_failed: insufficient wallet balance',
    'vend_in_progress: insufficient funds',
    'AIRTIME-PURCHASE-FAILED',
    'Vend request timed out: insufficient wallet balance',
    'Gateway timeout',
    'time-out waiting for biller',
    'Vend transaction was unsuccessful: insufficient wallet balance',
    'Failed to vend airtime',
    'Airtime delivered',
    'Request processed',
    'Transaction completed',
    'Vend successful',
  ])('flags "%s" as a vend outcome', (text) => {
    expect(isMonnifyVendOutcomeText(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'Amount must be greater than zero',
    'Unauthorized',
    'Access denied',
    '{"requestSuccessful":false,"responseMessage":"Insufficient wallet balance"}',
    'Request could not be processed',
    'Airtime not delivered',
    "Couldn't be completed",
    'Cannot be processed',
    'Has never been vended',
    'request-could-not-be-processed: insufficient wallet balance',
    'not-delivered',
    'Customer validation successful',
    'Login successful',
    'Request could not have been processed due to insufficient wallet balance',
    'not yet delivered',
    'did not get delivered',
    '',
    null,
  ])('does not flag "%s"', (text) => {
    expect(isMonnifyVendOutcomeText(text)).toBe(false);
  });
});
