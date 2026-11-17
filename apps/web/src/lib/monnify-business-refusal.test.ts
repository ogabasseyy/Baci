import { describe, expect, it } from 'vitest';
import { isMonnifyDefiniteBusinessRefusal } from './monnify-business-refusal';

function classify(envelope: Record<string, unknown>) {
  return isMonnifyDefiniteBusinessRefusal({
    envelope,
    rawMessage: String(envelope.responseMessage ?? ''),
    responseCode: envelope.responseCode as string | undefined,
  });
}

describe('isMonnifyDefiniteBusinessRefusal', () => {
  it('accepts a plain low-balance refusal', () => {
    expect(
      classify({
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
      })
    ).toBe(true);
  });

  it('ignores a false refusal key next to an unrelated message', () => {
    expect(
      classify({
        responseCode: '01',
        responseMessage: 'Request failed',
        responseBody: { insufficient_wallet_balance: false },
      })
    ).toBe(false);
  });

  it('honours duplicate: false but not duplicate: true', () => {
    const base = {
      responseCode: '01',
      responseMessage: 'Insufficient wallet balance',
    };
    expect(classify({ ...base, responseBody: { duplicate: false } })).toBe(
      true
    );
    expect(classify({ ...base, responseBody: { duplicate: true } })).toBe(
      false
    );
  });

  it('is not blocked by unrelated validation-success wording', () => {
    expect(
      classify({
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
        responseBody: { validationMessage: 'Customer validation successful' },
      })
    ).toBe(true);
  });

  it.each(['99', '408'])('rules out code %s', (responseCode) => {
    expect(
      classify({ responseCode, responseMessage: 'Insufficient wallet balance' })
    ).toBe(false);
  });
});
