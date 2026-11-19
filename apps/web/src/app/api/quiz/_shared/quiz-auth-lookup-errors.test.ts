import { describe, expect, it } from 'vitest';
import {
  getSafeAuthErrorFields,
  isMissingAuthSession,
  isRejectedCredentialError,
} from './quiz-auth-lookup-errors';

describe('quiz auth lookup errors', () => {
  it('keeps only the message, code and status of an error', () => {
    expect(
      getSafeAuthErrorFields({
        code: 'bad_jwt',
        message: 'invalid JWT',
        status: 403,
        token: 'secret-token',
      })
    ).toEqual({
      errorCode: 'bad_jwt',
      errorMessage: 'invalid JWT',
      errorStatus: 403,
    });
    expect(getSafeAuthErrorFields('boom')).toEqual({ errorMessage: 'boom' });
    expect(getSafeAuthErrorFields(null)).toEqual({ errorMessage: 'null' });
  });

  it.each([
    400, 401, 403, 404, 422,
  ])('treats a %i from Supabase Auth as a rejected credential', (status) => {
    expect(isRejectedCredentialError({ message: 'no', status })).toBe(true);
  });

  it.each([
    408, 429, 500, 502, 503, 504,
  ])('treats a %i from Supabase Auth as the service failing', (status) => {
    expect(isRejectedCredentialError({ message: 'no', status })).toBe(false);
  });

  it('does not treat an error without a status as a rejected credential', () => {
    expect(isRejectedCredentialError(new Error('fetch failed'))).toBe(false);
    expect(isRejectedCredentialError(undefined)).toBe(false);
  });

  it('recognises a missing browser session by message, code or status', () => {
    expect(isMissingAuthSession({ message: 'Auth session missing!' })).toBe(
      true
    );
    expect(isMissingAuthSession({ code: 'session_not_found' })).toBe(true);
    expect(isMissingAuthSession({ code: 'no_authorization' })).toBe(true);
    expect(
      isMissingAuthSession({ message: 'session expired', status: 400 })
    ).toBe(true);
  });

  it('does not mistake other failures for a missing session', () => {
    expect(isMissingAuthSession({ message: 'bad request', status: 400 })).toBe(
      false
    );
    expect(
      isMissingAuthSession({ message: 'upstream down', status: 503 })
    ).toBe(false);
  });
});
