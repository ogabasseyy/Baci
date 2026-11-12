import { sendStorefrontOtp, verifyStorefrontOtp } from './storefront-auth-api';
import { supabase } from './supabase';
import {
  accessTokenSubject,
  confirmIdentityCode,
  sendIdentityCode,
} from './wallet-identity-confirm-api';

jest.mock('./storefront-auth-api', () => ({
  sendStorefrontOtp: jest.fn(),
  verifyStorefrontOtp: jest.fn(),
}));
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      setSession: jest.fn(),
      mfa: { getAuthenticatorAssuranceLevel: jest.fn() },
    },
  },
}));

const tokenFor = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
const setSession = supabase.auth.setSession as jest.Mock;
const verify = jest.mocked(verifyStorefrontOtp);

const assurance = supabase.auth.mfa.getAuthenticatorAssuranceLevel as jest.Mock;
const level = (nextLevel: string) =>
  assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel },
    error: null,
  });

beforeEach(() => {
  jest.resetAllMocks();
  level('aal1');
});

// It only uses the normal sign-in code endpoints, which work whether or not
// the server has PiggyVest on, and only when the customer asks.
describe('confirm it is you', () => {
  it('reads the account from an access token, and nothing from junk', () => {
    expect(accessTokenSubject(tokenFor('user-1'))).toBe('user-1');
    expect(accessTokenSubject('junk')).toBeNull();
    expect(accessTokenSubject('a.%%%.b')).toBeNull();
  });

  it('sends the normal sign-in code and reports a refusal', async () => {
    jest.mocked(sendStorefrontOtp).mockResolvedValueOnce({
      success: true,
      data: undefined,
    });
    await sendIdentityCode('a@b.co');
    expect(sendStorefrontOtp).toHaveBeenCalledWith('a@b.co');
    jest
      .mocked(sendStorefrontOtp)
      .mockResolvedValueOnce({ success: false, error: 'Slow down.' });
    await expect(sendIdentityCode('a@b.co')).rejects.toThrow('Slow down.');
  });

  it('adopts the fresh session in place for the same account', async () => {
    verify.mockResolvedValue({
      success: true,
      data: { access_token: tokenFor('user-1'), refresh_token: 'r' },
    });
    setSession.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    await confirmIdentityCode({
      email: 'a@b.co',
      code: '123456',
      expectedUserId: 'user-1',
    });
    expect(setSession).toHaveBeenCalledWith({
      access_token: tokenFor('user-1'),
      refresh_token: 'r',
    });
  });

  it('never adopts a session for another account', async () => {
    verify.mockResolvedValue({
      success: true,
      data: { access_token: tokenFor('user-2'), refresh_token: 'r' },
    });
    await expect(
      confirmIdentityCode({
        email: 'a@b.co',
        code: '1',
        expectedUserId: 'user-1',
      })
    ).rejects.toThrow('different account');
    expect(setSession).not.toHaveBeenCalled();
  });

  it('passes on a wrong code and a failed session swap', async () => {
    verify.mockResolvedValueOnce({ success: false, error: 'Invalid code.' });
    await expect(
      confirmIdentityCode({
        email: 'a@b.co',
        code: '1',
        expectedUserId: 'user-1',
      })
    ).rejects.toThrow('Invalid code.');
    verify.mockResolvedValueOnce({
      success: true,
      data: { access_token: tokenFor('user-1'), refresh_token: 'r' },
    });
    setSession.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('x'),
    });
    await expect(
      confirmIdentityCode({
        email: 'a@b.co',
        code: '1',
        expectedUserId: 'user-1',
      })
    ).rejects.toThrow('could not confirm');
  });

  it('stops before sending a code or swapping sessions for a two-step account', async () => {
    level('aal2');
    await expect(sendIdentityCode('a@b.co')).rejects.toThrow(
      'two-step verification'
    );
    await expect(
      confirmIdentityCode({
        email: 'a@b.co',
        code: '1',
        expectedUserId: 'user-1',
      })
    ).rejects.toThrow('two-step verification');
    expect(sendStorefrontOtp).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('carries on when the two-step check itself fails (the server still enforces)', async () => {
    assurance.mockRejectedValue(new Error('offline'));
    jest
      .mocked(sendStorefrontOtp)
      .mockResolvedValue({ success: true, data: undefined });
    await sendIdentityCode('a@b.co');
    expect(sendStorefrontOtp).toHaveBeenCalledWith('a@b.co');
  });
});

it('decodes the token without a global atob', () => {
  const original = globalThis.atob;
  // @ts-expect-error simulate a runtime with no atob
  delete globalThis.atob;
  try {
    expect(accessTokenSubject(tokenFor('user-1'))).toBe('user-1');
  } finally {
    globalThis.atob = original;
  }
});
