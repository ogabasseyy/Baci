import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  recordQuarantineEvent,
  resolveQuarantineEvent,
} from './event-quarantine';

function mockSupabase(queues: {
  upserts?: Array<{ data: unknown; error: unknown }>;
  updates?: Array<{ data: unknown; error: unknown }>;
}): { client: PiggyvestIntakeServiceClient; from: ReturnType<typeof vi.fn> } {
  const upsertQueue = [...(queues.upserts ?? [])];
  const updateQueue = [...(queues.updates ?? [])];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    upsert: vi.fn(() => {
      const result = upsertQueue.shift() ?? { data: [], error: null };
      return { select: vi.fn(async () => result) };
    }),
    update: vi.fn(() => {
      const result = updateQueue.shift() ?? { data: [], error: null };
      return {
        eq: vi.fn(() => ({ select: vi.fn(async () => result) })),
      };
    }),
  });
  const from = vi.fn(() => chain);
  return {
    client: { from } as unknown as PiggyvestIntakeServiceClient,
    from,
  };
}

const INPUT = {
  bodyDigest: 'a'.repeat(64),
  reason: 'unknown-event' as const,
  eventId: 'evt-synthetic-001',
  eventType: 'some-future.success',
};

describe('recordQuarantineEvent', () => {
  it('records a new quarantine row', async () => {
    const { client, from } = mockSupabase({
      upserts: [{ data: [{ body_digest: INPUT.bodyDigest }], error: null }],
    });

    await expect(recordQuarantineEvent(client, INPUT)).resolves.toBe(
      'recorded'
    );
    expect(from).toHaveBeenCalledWith('piggyvest_event_quarantine');
  });

  it('collapses identical redeliveries on the body digest', async () => {
    const { client } = mockSupabase({ upserts: [{ data: [], error: null }] });

    await expect(recordQuarantineEvent(client, INPUT)).resolves.toBe(
      'duplicate'
    );
  });

  it('rejects oversized detail instead of storing it', async () => {
    const { client } = mockSupabase({ upserts: [] });

    await expect(
      recordQuarantineEvent(client, {
        ...INPUT,
        bodyDigest: 'b'.repeat(64),
        detail: { blob: 'x'.repeat(16 * 1024) },
      })
    ).rejects.toThrow();
  });

  it('surfaces storage failures for a provider retry', async () => {
    const { client } = mockSupabase({
      upserts: [{ data: null, error: { message: 'db down' } }],
    });

    await expect(recordQuarantineEvent(client, INPUT)).rejects.toThrow(
      'Quarantine record failed'
    );
  });
});

describe('resolveQuarantineEvent', () => {
  it('marks a reviewed row resolved', async () => {
    const { client, from } = mockSupabase({
      updates: [{ data: [{ body_digest: INPUT.bodyDigest }], error: null }],
    });

    await expect(
      resolveQuarantineEvent(client, {
        bodyDigest: INPUT.bodyDigest,
        resolution: 'reviewed: provider sample accepted',
      })
    ).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('piggyvest_event_quarantine');
  });
});
