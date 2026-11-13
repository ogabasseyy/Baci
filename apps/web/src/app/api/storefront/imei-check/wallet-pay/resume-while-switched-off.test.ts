import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('../route-helpers', () => ({
  findLookupByIdempotencyKey: mocks.find,
}));

import { resumeWhileSwitchedOff } from './resume-paid-imei-wallet-payment';

const input = {
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  replayContext: {
    customerId: 'c',
    merchantId: 'm',
    imeiHash: 'h',
    tier: 'simLock' as const,
  },
  supabase: {} as never,
  supabaseAdmin: {} as never,
  user: { id: 'u' } as never,
};

beforeEach(() => vi.clearAllMocks());

describe('bugfix: a paid IMEI replay could not resume while wallet pay was off (Codex P2)', () => {
  it('resumes the lookup this same key created', async () => {
    const existing = { id: 'lookup-1' };
    mocks.find.mockResolvedValue(existing);
    const answer = new Response('{}', { status: 202 });
    const resume = vi.fn(async () => answer);
    await expect(resumeWhileSwitchedOff(input, resume)).resolves.toBe(answer);
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({ existing, customerId: 'c', imeiHash: 'h' })
    );
  });

  it('answers null for a fresh start, or when the read or resume fails', async () => {
    const resume = vi.fn(async () => {
      throw new Error('db down');
    });
    mocks.find.mockResolvedValue(null);
    await expect(resumeWhileSwitchedOff(input, resume)).resolves.toBeNull();
    expect(resume).not.toHaveBeenCalled();
    mocks.find.mockRejectedValue(new Error('read failed'));
    await expect(resumeWhileSwitchedOff(input, resume)).resolves.toBeNull();
    mocks.find.mockResolvedValue({ id: 'lookup-1' });
    await expect(resumeWhileSwitchedOff(input, resume)).resolves.toBeNull();
  });
});
