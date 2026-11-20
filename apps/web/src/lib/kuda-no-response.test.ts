import { describe, expect, it } from 'vitest';
import { isKudaNoResponse } from './kuda-no-response';
import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

describe('isKudaNoResponse', () => {
  it.each([
    ['a server error', new KudaApiHttpError(503, 'Service Unavailable')],
    ['an HTTP timeout', new KudaApiHttpError(408, 'Request Timeout')],
    ['a rate limit', new KudaApiHttpError(429, 'Too Many Requests')],
    [
      'a login that never reached Kuda',
      new KudaPreDispatchError('token failed'),
    ],
    [
      'a login answered with a server error',
      new KudaPreDispatchError('Failed to get Kuda token: Bad Gateway', 502),
    ],
    ['a dropped connection', new TypeError('fetch failed')],
    ['a timeout', new Error('Kuda GET_BILLERS_BY_TYPE request timed out')],
    ['an abort', Object.assign(new Error('aborted'), { name: 'AbortError' })],
    [
      'a reset connection',
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    ],
    [
      'a lookup failure in the cause',
      new TypeError('request failed', {
        cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
      }),
    ],
    [
      'a hung-up socket',
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    ],
  ])('treats %s as no answer', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(true);
  });

  it.each([
    ['a bad request', new KudaApiHttpError(400, 'Bad Request')],
    [
      'a login rejected for bad credentials',
      new KudaPreDispatchError('Failed to get Kuda token: Unauthorized', 401),
    ],
    ['a rejected login', new KudaApiHttpError(401, 'Unauthorized')],
    ['an unknown type', new KudaApiHttpError(404, 'Not Found')],
    ['a refused list', new Error('Bill prices could not be confirmed as kobo')],
    ['a broken body', new SyntaxError('Unexpected token < in JSON')],
    [
      'a broken body that quotes "socket hang up"',
      new SyntaxError(
        'Unexpected token \'s\', "socket hang up" is not valid JSON'
      ),
    ],
    [
      'a broken answer that fails to map',
      new TypeError("Cannot read properties of null (reading 'id')"),
    ],
    ['an unknown error', new Error('Kuda down')],
    [
      'another error that mentions a timeout',
      new Error('Bill prices could not be confirmed (timeout in unit check)'),
    ],
    ['a non-error value', 'oops'],
  ])('treats %s as an answer Baci refuses', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(false);
  });
});
