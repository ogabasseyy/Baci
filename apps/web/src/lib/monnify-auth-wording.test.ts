import { describe, expect, it } from 'vitest';
import { mentionsMonnifyAuthWording } from './monnify-auth-wording';

describe('mentionsMonnifyAuthWording', () => {
  it.each([
    'Invalid token: insufficient wallet balance',
    'INVALID_TOKEN',
    'AUTHENTICATION_FAILED',
    'Unauthorized',
    'Access token has expired',
    'auth failed',
    'User not authenticated',
    'Invalid API key',
    'ApiKey is invalid',
    'Credentials expired',
    'login failed',
    'Sign-in failed',
    'LOGIN_FAILED',
    'failed to log in',
    'Authentication unsuccessful: insufficient wallet balance',
    'Login unsuccessful',
  ])('reads %s as login wording', (text) => {
    expect(mentionsMonnifyAuthWording(text)).toBe(true);
  });

  it.each([
    'Insufficient wallet balance',
    'Amount must be greater than zero',
    '',
    null,
  ])('does not read %j as login wording', (text) => {
    expect(mentionsMonnifyAuthWording(text)).toBe(false);
  });
});
