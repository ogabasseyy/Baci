import { describe, expect, it } from 'vitest';
import { isKudaNoResponse } from './kuda-no-response';
import { KudaApiHttpError, KudaPreDispatchError } from './kuda-transport-error';

describe('isKudaNoResponse', () => {
  it.each([
    ['an HTTP error status', new KudaApiHttpError(503, 'Service Unavailable')],
    ['a failed login', new KudaPreDispatchError('token failed')],
    ['a dropped connection', new TypeError('fetch failed')],
    ['a timeout', new Error('Kuda GET_BILLERS_BY_TYPE request timed out')],
    ['a short timeout message', new Error('Kuda timeout')],
    ['an abort', Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ])('treats %s as no answer', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(true);
  });

  it.each([
    ['a refused list', new Error('Bill prices could not be confirmed as kobo')],
    ['a broken body', new SyntaxError('Unexpected token < in JSON')],
    ['an unknown error', new Error('Kuda down')],
    ['a non-error value', 'oops'],
  ])('treats %s as an answer Baci refuses', (_label, error) => {
    expect(isKudaNoResponse(error)).toBe(false);
  });
});
