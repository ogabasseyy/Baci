import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import { enforceQuizStartGuards } from './v2-start-guards';

function client(
  mode = 'live',
  dateOfBirth = '2000-01-01',
  error: unknown = null
) {
  const event = {
    mode,
    merchant_id: 'merchant-1',
    compliance_verified: true,
    regulatory_basis: 'free_skill_competition',
    regulatory_jurisdiction: 'NG-LA',
    regulatory_evidence_ref: 'approved-reference',
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'quiz_events' ? event : { date_of_birth: dateOfBirth },
        error,
      }),
    };
    return query;
  });
  return { from } as unknown as ServerSupabaseClient;
}

afterEach(() => vi.unstubAllEnvs());
describe('v2 start production gates', () => {
  it('blocks underage players before starting an attempt', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    await expect(
      enforceQuizStartGuards(client('live', '2020-01-01'), 'event-1', 'user-1')
    ).rejects.toMatchObject({ code: 'quiz_age_restricted' });
  });
  it('accepts an adult live player with approved evidence', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1')
    ).resolves.toBeUndefined();
  });
  it('does not require live-prize approval for a private test', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'false');
    await expect(
      enforceQuizStartGuards(client('test'), 'event-1', 'user-1')
    ).resolves.toBeUndefined();
  });
  it('fails closed on event lookup failure', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    await expect(
      enforceQuizStartGuards(
        client('live', '2000-01-01', new Error('offline')),
        'event-1',
        'user-1'
      )
    ).rejects.toThrow();
  });
  it('blocks an unapproved live launch', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'false');
    await expect(
      enforceQuizStartGuards(client(), 'event-1', 'user-1')
    ).rejects.toThrow();
  });
});
