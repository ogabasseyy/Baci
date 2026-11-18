import { ApiError, RetryExhaustedError } from './api-core';
import { customerErrorText } from './customer-error-text';
import { NetworkError, TimeoutError } from './fetch-with-timeout';

const FALLBACK = 'Please try again in a moment.';
const response = (status: number) =>
  ({ status, statusText: 'x' }) as unknown as Response;

// Walk 14: "Request timed out after 30000ms" and "fetch failed: Could not
// connect to the server." reached customers verbatim.
describe('customerErrorText', () => {
  it.each([
    ['our timeout', new TimeoutError(30000)],
    ['a network error', new NetworkError('Network request failed')],
    ['a fetch TypeError', new TypeError('Network request failed')],
    ['exhausted retries', new RetryExhaustedError(3, new Error('boom'))],
    ['a server fault', new ApiError(response(502), { error: 'Bad gateway' })],
    ['a bare HTTP status', new ApiError(response(404))],
    [
      'fetch wording',
      new Error('fetch failed: Could not connect to the server.'),
    ],
  ])('replaces %s with the fallback', (_, error) => {
    expect(customerErrorText(error, FALLBACK)).toBe(FALLBACK);
  });

  it('keeps a server message written for customers', () => {
    const error = new ApiError(response(409), {
      error: 'This goal is already complete.',
    });
    expect(customerErrorText(error, FALLBACK)).toBe(
      'This goal is already complete.'
    );
  });

  it('keeps an app error thrown with its own customer wording', () => {
    expect(
      customerErrorText(new Error('Your savings plan is paused.'), FALLBACK)
    ).toBe('Your savings plan is paused.');
  });

  it.each(['', '   '])('uses the fallback for a blank message (%j)', (msg) => {
    expect(customerErrorText(new Error(msg), FALLBACK)).toBe(FALLBACK);
  });

  it('uses the fallback for anything that is not an Error', () => {
    expect(customerErrorText('nope', FALLBACK)).toBe(FALLBACK);
  });
});
