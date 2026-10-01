import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createScopedClient: vi.fn(),
  signScopedSupabaseJwt: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.signScopedSupabaseJwt,
}));

import { createQuizAwardRpcClient } from './quiz-award-rpc-client';

const fallbackClient = {} as SupabaseClient;
const signedClient = {} as SupabaseClient;

describe('createQuizAwardRpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signScopedSupabaseJwt.mockReturnValue('signed-quiz-token');
    mocks.createScopedClient.mockReturnValue(signedClient);
  });

  it('signs a short-lived legacy quiz award context for the authenticated user', () => {
    const client = createQuizAwardRpcClient({
      fallbackClient,
      userId: ' user-123 ',
      now: new Date('2026-08-28T00:00:00.000Z'),
    });

    expect(client).toBe(signedClient);
    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith({
      aud: 'authenticated',
      exp: 1_787_875_500,
      iat: 1_787_875_200,
      quiz_award_context: 'legacy-answer',
      role: 'authenticated',
      sub: 'user-123',
    });
    expect(mocks.createScopedClient).toHaveBeenCalledWith('signed-quiz-token');
  });

  it('uses the injected mock only in tests when signing material is unavailable', () => {
    mocks.signScopedSupabaseJwt.mockImplementation(() => {
      throw new Error('missing signing material');
    });

    expect(
      createQuizAwardRpcClient({ fallbackClient, userId: 'user-123' })
    ).toBe(fallbackClient);
  });
});
