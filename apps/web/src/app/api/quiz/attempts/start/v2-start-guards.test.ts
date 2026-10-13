import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import { enforceQuizStartGuards } from './v2-start-guards';

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
describe('v2 start production gates', () => {
  it('blocks underage players before starting an attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    await expect(
      enforceQuizStartGuards(
        client({ dateOfBirth: '2020-01-01' }),
        'event-1',
        'user-1'
      )
    ).rejects.toMatchObject({ code: 'quiz_age_restricted' });
  });
  it('accepts an adult live player with approved evidence', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    const supabase = client();
    await expect(
      enforceQuizStartGuards(supabase, 'event-1', 'user-1')
    ).resolves.toBeUndefined();
    // RLS hides v2 event rows from players, so the guard must resolve
    // mode/merchant through the projection RPC and never read quiz_events.
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_quiz_start_guard_context_v2',
      { p_event_id: 'event-1' }
    );
    expect(supabase.from).not.toHaveBeenCalledWith('quiz_events');
  });
  it('does not require live-prize approval for a private test', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'false');
    await expect(
      enforceQuizStartGuards(
        client({
          context: {
            found: true,
            merchant_id: 'merchant-1',
            mode: 'test',
            prize_approved: false,
          },
        }),
        'event-1',
        'user-1'
      )
    ).resolves.toBeUndefined();
  });
  it('fails closed on guard context lookup failure', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    await expect(
      enforceQuizStartGuards(
        client({ contextError: new Error('offline') }),
        'event-1',
        'user-1'
      )
    ).rejects.toThrow('Quiz start eligibility could not be verified');
  });
  it('fails closed on missing events and malformed context', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    await expect(
      enforceQuizStartGuards(
        client({ context: { found: false } }),
        'event-1',
        'user-1'
      )
    ).rejects.toThrow('Quiz start eligibility could not be verified');
    await expect(
      enforceQuizStartGuards(
        client({
          context: {
            found: true,
            merchant_id: 'merchant-1',
            mode: 'rehearsal',
            prize_approved: true,
          },
        }),
        'event-1',
        'user-1'
      )
    ).rejects.toThrow('Quiz start eligibility could not be verified');
  });
  it('blocks an unapproved live launch', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'false');
    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1')
    ).rejects.toMatchObject({ code: 'quiz_production_not_approved' });
  });
  it('blocks a live launch with a negative compliance verdict', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    await expect(
      enforceQuizStartGuards(
        client({
          context: {
            found: true,
            merchant_id: 'merchant-1',
            mode: 'live',
            prize_approved: false,
          },
        }),
        'event-1',
        'user-1'
      )
    ).rejects.toMatchObject({ code: 'quiz_production_not_approved' });
  });
});
