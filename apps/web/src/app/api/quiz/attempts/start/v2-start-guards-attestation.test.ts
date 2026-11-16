import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import { verifyQuizAppCheckToken } from '@/lib/quiz/quiz-app-check';
import { consumeQuizAttestationChallenge } from '@/lib/quiz/quiz-attestation-challenge';
import { enforceQuizStartGuards } from './v2-start-guards';

vi.mock('@/lib/quiz/quiz-app-check', () => ({
  verifyQuizAppCheckToken: vi.fn(),
}));
vi.mock('@/lib/quiz/quiz-attestation-challenge', () => ({
  consumeQuizAttestationChallenge: vi.fn(),
}));
const ISSUED = new Date('2026-11-15T10:00:00Z');
const NONCE = 'n'.repeat(43);

function client({
  context = {
    found: true,
    merchant_id: 'merchant-1',
    mode: 'live',
    prize_approved: true,
  },
  contextError: error = null,
  dateOfBirth = '2000-01-01',
}: {
  context?: unknown;
  contextError?: unknown;
  dateOfBirth?: string;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: context, error });
  const from = vi.fn((_table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { date_of_birth: dateOfBirth },
        error: null,
      }),
    };
    return query;
  });
  return { from, rpc } as unknown as ServerSupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('bugfix: copied bearer token replayed as the app for a live prize', () => {
  const liveTest = {
    found: true,
    merchant_id: 'merchant-1',
    mode: 'test',
    prize_approved: false,
  };

  function production(mode: 'enforce' | 'monitor' | 'off') {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    vi.stubEnv('QUIZ_APP_CHECK_PROJECT_NUMBER', '499767419832');
    vi.stubEnv(
      'QUIZ_APP_CHECK_APP_IDS',
      '1:499767419832:android:a, 1:499767419832:ios:b'
    );
    vi.stubEnv('QUIZ_APP_ATTESTATION', mode);
  }

  afterEach(() => {
    vi.mocked(verifyQuizAppCheckToken).mockReset();
    vi.mocked(consumeQuizAttestationChallenge).mockReset();
  });

  it('rejects a bearer start with no app attestation once enforcement is on', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: false,
      reason: 'missing_token',
    });

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'bearer', null)
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ATTESTATION_REQUIRED' });
  });

  it('rejects a bearer start whose attestation does not verify', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: false,
      reason: 'invalid_token',
    });

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'bearer', 'forged')
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ATTESTATION_REQUIRED' });
  });

  it('passes the token and the configured app ids to the verifier', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: true,
      issuedAt: ISSUED,
    });
    vi.mocked(consumeQuizAttestationChallenge).mockResolvedValue(true);

    await expect(
      enforceQuizStartGuards(
        client(),
        'event-1',
        'user-1',
        'bearer',
        'real',
        NONCE
      )
    ).resolves.toBeUndefined();
    expect(consumeQuizAttestationChallenge).toHaveBeenCalledWith(
      expect.anything(),
      { eventId: 'event-1', nonce: NONCE, token: 'real', tokenIssuedAt: ISSUED }
    );
    expect(verifyQuizAppCheckToken).toHaveBeenCalledWith('real', {
      allowedAppIds: ['1:499767419832:android:a', '1:499767419832:ios:b'],
      projectNumber: '499767419832',
    });
  });

  it('rejects a replayed or expired challenge even with a valid token', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: true,
      issuedAt: ISSUED,
    });
    vi.mocked(consumeQuizAttestationChallenge).mockResolvedValue(false);

    await expect(
      enforceQuizStartGuards(
        client(),
        'event-1',
        'user-1',
        'bearer',
        'real',
        NONCE
      )
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ATTESTATION_REQUIRED' });
  });

  it('rejects a valid token that carries no challenge nonce', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: true,
      issuedAt: ISSUED,
    });

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'bearer', 'real')
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ATTESTATION_REQUIRED' });
    expect(consumeQuizAttestationChallenge).not.toHaveBeenCalled();
  });

  it('fails closed when attestation is not configured on the server', async () => {
    production('enforce');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    });

    await expect(
      enforceQuizStartGuards(
        client(),
        'event-1',
        'user-1',
        'bearer',
        'real',
        NONCE
      )
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ATTESTATION_REQUIRED' });
  });

  it('only logs a missing attestation in monitor mode so the app rollout can finish', async () => {
    production('monitor');
    vi.mocked(verifyQuizAppCheckToken).mockResolvedValue({
      ok: false,
      reason: 'missing_token',
    });

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'bearer', null)
    ).resolves.toBeUndefined();
    expect(verifyQuizAppCheckToken).toHaveBeenCalledTimes(1);
  });

  it('does not check attestation at all when the flag is off', async () => {
    production('off');

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'bearer', null)
    ).resolves.toBeUndefined();
    expect(verifyQuizAppCheckToken).not.toHaveBeenCalled();
  });

  it('does not require attestation for a private test quiz', async () => {
    production('enforce');

    await expect(
      enforceQuizStartGuards(
        client({ context: liveTest }),
        'event-1',
        'user-1',
        'bearer',
        null
      )
    ).resolves.toBeUndefined();
    expect(verifyQuizAppCheckToken).not.toHaveBeenCalled();
  });

  it('keeps refusing a browser session as app-only before looking at attestation', async () => {
    production('enforce');

    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1', 'cookie', 'real')
    ).rejects.toMatchObject({ code: 'QUIZ_APP_ONLY' });
    expect(verifyQuizAppCheckToken).not.toHaveBeenCalled();
  });
});
