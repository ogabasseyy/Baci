import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMagicLink } from '@/app/(platform)/onboarding/actions';
import {
  type AuthStepHandlersContext,
  runWebAuthQuickReply,
  runWebAuthTextInput,
} from './web-onboarding-auth-handlers';

const mockSignInWithOAuth = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOAuth: mockSignInWithOAuth,
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
    },
  })),
}));

vi.mock('@/app/(platform)/onboarding/actions', () => ({
  sendMagicLink: vi.fn(),
}));

function makeCtx(
  overrides: Partial<AuthStepHandlersContext> = {}
): AuthStepHandlersContext {
  return {
    step: 'auth_choice',
    authDraft: { fullName: '', email: '', password: '' },
    setAuthDraft: vi.fn(),
    setStep: vi.fn(),
    setIsBusy: vi.fn(),
    appendMessages: vi.fn(),
    enterStoreSetup: vi.fn(),
    ...overrides,
  };
}

describe('web-onboarding-auth-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    vi.mocked(sendMagicLink).mockResolvedValue({
      success: true,
      message: 'Magic link sent!',
    });
  });

  it('starts Google OAuth with /auth/callback?next=/onboarding', async () => {
    const ctx = makeCtx();
    await runWebAuthQuickReply(
      { id: 'auth:google', label: 'Continue with Google' },
      ctx
    );

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: expect.stringContaining('/auth/callback?next=/onboarding'),
      },
    });
  });

  it('sends a magic link and advances to auth_check_email', async () => {
    const ctx = makeCtx({ step: 'auth_magic_email' });
    await runWebAuthTextInput('ada@example.com', ctx);

    expect(sendMagicLink).toHaveBeenCalledWith('ada@example.com');
    expect(ctx.setStep).toHaveBeenCalledWith('auth_check_email');
  });

  it('creates an account on matching password confirmation and enters store setup when session exists', async () => {
    const user = { id: 'u-1', email: 'ada@example.com' } as never;
    mockSignUp.mockResolvedValueOnce({
      data: { user, session: { access_token: 'tok' } },
      error: null,
    });
    const ctx = makeCtx({
      step: 'auth_confirm',
      authDraft: {
        fullName: 'Ada Okafor',
        email: 'ada@example.com',
        password: 'StrongPassword!2026',
      },
    });

    await runWebAuthTextInput('StrongPassword!2026', ctx);

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        password: 'StrongPassword!2026',
      })
    );
    expect(ctx.enterStoreSetup).toHaveBeenCalledWith(user);
  });

  it('re-checks session on auth:check_session and enters store setup once confirmed out-of-band', async () => {
    const user = { id: 'u-2', email: 'ada@example.com' } as never;
    mockGetUser.mockResolvedValueOnce({ data: { user } });
    const ctx = makeCtx({ step: 'auth_check_email' });

    await runWebAuthQuickReply(
      { id: 'auth:check_session', label: "I've confirmed my email" },
      ctx
    );

    expect(ctx.enterStoreSetup).toHaveBeenCalledWith(user);
  });

  it('routes auth:edit_email back to auth_magic_email when coming from the magic-link flow', async () => {
    const ctx = makeCtx({ step: 'auth_check_email' });
    await runWebAuthQuickReply(
      { id: 'auth:edit_email', label: 'Use another email' },
      ctx
    );

    expect(ctx.setStep).toHaveBeenCalledWith('auth_magic_email');
  });

  it('falls back to signInWithPassword when signUp returns an obfuscated existing account (identities: [])', async () => {
    const existingUser = {
      id: 'u-existing',
      email: 'ada@example.com',
    } as never;
    mockSignUp.mockResolvedValueOnce({
      data: { user: { id: 'u-existing', identities: [] }, session: null },
      error: null,
    });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: existingUser, session: { access_token: 'tok' } },
      error: null,
    });
    const ctx = makeCtx({
      step: 'auth_confirm',
      authDraft: {
        fullName: 'Ada Okafor',
        email: 'ada@example.com',
        password: 'StrongPassword!2026',
      },
    });

    await runWebAuthTextInput('StrongPassword!2026', ctx);

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'StrongPassword!2026',
    });
    expect(ctx.enterStoreSetup).toHaveBeenCalledWith(existingUser);
    expect(ctx.setStep).not.toHaveBeenCalledWith('auth_check_email');
  });

  it('guides returning users back to auth_choice when existing-account sign-in fails with wrong password', async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        code: 'user_already_exists',
        message: 'User already registered',
      },
    });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });
    const ctx = makeCtx({
      step: 'auth_confirm',
      authDraft: {
        fullName: 'Ada Okafor',
        email: 'ada@example.com',
        password: 'WrongPassword!2026',
      },
    });

    await runWebAuthTextInput('WrongPassword!2026', ctx);

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'WrongPassword!2026',
    });
    expect(ctx.setStep).toHaveBeenCalledWith('auth_choice');
    expect(ctx.enterStoreSetup).not.toHaveBeenCalled();
  });
});
