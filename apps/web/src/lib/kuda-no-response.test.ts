import { describe, expect, it } from 'vitest';
import { isKudaNoResponse } from './kuda-no-response';
import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

describe('isKudaNoResponse', () => {
  it.each([
    ['a server error', new KudaApiHttpError(503, 'Service Unavailable')],
    ['an HTTP timeout', new KudaApiHttpError(408, 'Request Timeout')],
    ['a rate limit', new KudaApiHttpError(429, 'Too Many Requests')],
    ['a failed login', new KudaPreDispatchError('token failed')],
    ['a dropped connection', new TypeError('fetch failed')],
    ['a timeout', new Error('Kuda GET_BILLERS_BY_TYPE request timed out')],
    ['a short timeout message', new Error('Kuda timeout')],
    ['an abort', Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ])('treats %s as no answer', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(true);
  });

  it.each([
    ['a bad request', new KudaApiHttpError(400, 'Bad Request')],
    ['a rejected login', new KudaApiHttpError(401, 'Unauthorized')],
    ['an unknown type', new KudaApiHttpError(404, 'Not Found')],
    ['a refused list', new Error('Bill prices could not be confirmed as kobo')],
    ['a broken body', new SyntaxError('Unexpected token < in JSON')],
    [
      'a broken answer that fails to map',
      new TypeError("Cannot read properties of null (reading 'id')"),
    ],
    ['an unknown error', new Error('Kuda down')],
    ['a non-error value', 'oops'],
  ])('treats %s as an answer Baci refuses', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(false);
  });
});
