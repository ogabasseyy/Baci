import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));

import {
  buildChatHandoverProof,
  recordChatHandover,
} from './chat-handover-intake';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const handover = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'chat-handover-2-128',
  conversationId: 21,
  customerName: 'Ada',
};
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { outcome: 'notified' }, error: null });
});

describe('buildChatHandoverProof', () => {
  it('matches the proof the database function computes', () => {
    // Vector produced by the SQL in supabase/tests/chat_handover_alerts.sql
    // (pg_temp.handover_proof) for the same inputs.
    expect(buildChatHandoverProof(SECRET, 1_794_730_000, handover)).toBe(
      'bb269241f1026d0c2302a4a9a2eb61134f35da312ca77b5e3c8b9122b377a566'
    );
  });

  it('changes when any signed field changes', () => {
    const base = buildChatHandoverProof(SECRET, 1_794_730_000, handover);
    expect(buildChatHandoverProof(SECRET, 1_794_730_001, handover)).not.toBe(
      base
    );
    for (const change of [
      { merchantId: 'c4a70000-0000-4000-8000-0000000000b2' },
      { eventKey: 'chat-handover-2-129' },
      { conversationId: 22 },
      { customerName: 'Bola' },
    ]) {
      expect(
        buildChatHandoverProof(SECRET, 1_794_730_000, {
          ...handover,
          ...change,
        })
      ).not.toBe(base);
    }
  });

  it('is not a valid proof for an ordinary customer message', async () => {
    const { buildChatEventProof } = await import('./chat-event-intake');
    expect(buildChatHandoverProof(SECRET, 1_794_730_000, handover)).not.toBe(
      buildChatEventProof(SECRET, 1_794_730_000, { ...handover, preview: '' })
    );
  });
});

describe('recordChatHandover', () => {
  it('sends the handover to the database with a proof', async () => {
    await expect(recordChatHandover(handover, env)).resolves.toEqual({
      ok: true,
      outcome: 'notified',
      duplicate: false,
    });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('record_chat_handover');
    expect(args).toMatchObject({
      p_merchant_id: handover.merchantId,
      p_event_key: 'chat-handover-2-128',
      p_conversation_id: 21,
      p_customer_name: 'Ada',
    });
    expect(args.p_proof).toBe(
      buildChatHandoverProof(SECRET, args.p_issued_at, handover)
    );
  });

  it('reports a duplicate delivery', async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: 'notified', duplicate: true },
      error: null,
    });
    await expect(recordChatHandover(handover, env)).resolves.toEqual({
      ok: true,
      outcome: 'notified',
      duplicate: true,
    });
  });

  it('does nothing without a configured secret', async () => {
    await expect(
      recordChatHandover(handover, {} as unknown as NodeJS.ProcessEnv)
    ).resolves.toEqual({ ok: false, code: 'not_configured' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['the database returns an error', { data: null, error: { message: 'x' } }],
    ['the answer has an unexpected shape', { data: { outcome: 'weird' } }],
  ])('reports unavailable when %s', async (_label, answer) => {
    mocks.rpc.mockResolvedValue(answer);
    await expect(recordChatHandover(handover, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('reports unavailable when the call throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('offline'));
    await expect(recordChatHandover(handover, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
