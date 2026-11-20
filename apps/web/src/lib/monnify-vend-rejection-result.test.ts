import { describe, expect, it } from 'vitest';
import { MonnifyHttpError } from './monnify-bills-errors';
import {
  buildMonnifyBusinessRejectionResult,
  buildMonnifyHttpRejectionResult,
} from './monnify-vend-rejection-result';

const REQ = 'a1b2c3d4e5f6a1b2c3d4e5f6';

function httpError(status: number, statusText: string, body: unknown) {
  return new MonnifyHttpError({
    detail: null,
    prefix: 'Monnify API error',
    rawDetail: typeof body === 'string' ? body : JSON.stringify(body),
    status,
    statusText,
  });
}

const http = (status: number, statusText: string, body: unknown) =>
  buildMonnifyHttpRejectionResult({
    amount: 100,
    error: httpError(status, statusText, body),
    requestReference: REQ,
  });

const business = (envelope: {
  responseCode: string;
  responseMessage?: string;
  responseBody?: unknown;
}) =>
  buildMonnifyBusinessRejectionResult({
    amount: 100,
    envelope: { requestSuccessful: false, ...envelope },
    parsedEnvelope: envelope,
    requestReference: REQ,
  });

describe('buildMonnifyHttpRejectionResult', () => {
  it('holds a timeout', () => {
    expect(
      http(408, 'Request Timeout', { responseMessage: 'x' })
    ).toMatchObject({ status: 'pending', providerOutcomeUnresolved: true });
  });

  it('holds when only the HTTP reason phrase says the vend is in progress', () => {
    expect(http(400, 'Vend in progress', {})).toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it("keeps Monnify's own vendReference on a held answer", () => {
    expect(
      http(409, 'Conflict', {
        responseMessage: 'Duplicate',
        responseBody: { vendReference: 'MFBP-5' },
      })
    ).toMatchObject({ providerVendReference: 'MFBP-5' });
  });

  it.each([
    [401, 'Unauthorized', 'Token expired'],
    [403, 'Forbidden', 'Access denied'],
    [429, 'Too Many Requests', 'Slow down'],
    [400, 'Bad Request', 'Invalid customer reference'],
  ])('fails (refunds) a %i answer: %s', (status, statusText, message) => {
    expect(
      http(status, statusText, { responseMessage: message })
    ).toMatchObject({ status: 'failed' });
  });

  it('keeps a known low-float refusal definite', () => {
    expect(
      http(400, 'Bad Request', {
        responseMessage: 'Insufficient wallet balance',
      })
    ).toMatchObject({ status: 'failed', providerDefiniteFailure: true });
  });
});

describe('buildMonnifyBusinessRejectionResult', () => {
  it('holds code 99', () => {
    expect(
      business({ responseCode: '99', responseMessage: 'Please re-query' })
    ).toMatchObject({ status: 'pending', providerOutcomeUnresolved: true });
  });

  it('holds the contradictory success code 0 on a rejection', () => {
    expect(
      business({ responseCode: '0', responseMessage: 'Rejected' })
    ).toMatchObject({ status: 'pending', providerOutcomeUnresolved: true });
  });

  it('fails an ordinary refusal and keeps its code', () => {
    expect(
      business({ responseCode: 'D02', responseMessage: 'Invalid customer' })
    ).toMatchObject({
      status: 'failed',
      providerDefiniteFailure: false,
      providerResponseCode: 'D02',
    });
  });

  it('keeps a known low-float refusal definite (goes to Kuda)', () => {
    expect(
      business({
        responseCode: '01',
        responseMessage: 'Insufficient wallet balance',
      })
    ).toMatchObject({ status: 'failed', providerDefiniteFailure: true });
  });
});

describe('bugfix: HTTP rejection carrying the success code 0 is held', () => {
  it('holds a 400 whose body says responseCode 0', () => {
    expect(
      http(400, 'Bad Request', {
        responseCode: '0',
        responseMessage: 'Rejected',
      })
    ).toMatchObject({ status: 'pending', providerOutcomeUnresolved: true });
  });
});

describe('bugfix: authentication wording overrides the success code 0', () => {
  it('refunds a business rejection with code 0 and "Invalid access token"', () => {
    expect(
      business({ responseCode: '0', responseMessage: 'Invalid access token' })
    ).toMatchObject({ status: 'failed' });
  });

  it('still holds code 0 without authentication wording', () => {
    expect(
      business({ responseCode: '0', responseMessage: 'Rejected' })
    ).toMatchObject({ status: 'pending' });
  });
});
