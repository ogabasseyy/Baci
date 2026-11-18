import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));

import {
  buildChatEventProof,
  normalizeChatEventText,
  recordChatCustomerMessage,
} from './chat-event-intake';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const event = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'chat-msg-2-128',
  conversationId: 21,
  customerName: 'Ada',
  preview: 'Is it in stock?',
};
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { outcome: 'notified' }, error: null });
});

describe('buildChatEventProof', () => {
  it('matches the proof the database function computes', () => {
    // Vector produced by the SQL in supabase/tests/chat_customer_message_notifications.sql
    // (pg_temp.chat_proof) for the same inputs.
    expect(buildChatEventProof(SECRET, 1_794_730_000, event)).toBe(
      '747410648ade99a6295db67e94d086798f56472d2faffcd276d3f0f1ba55617b'
    );
  });

  it('changes when any signed field changes', () => {
    const base = buildChatEventProof(SECRET, 1_794_730_000, event);
    expect(buildChatEventProof(SECRET, 1_794_730_001, event)).not.toBe(base);
    for (const change of [
      { merchantId: 'c4a70000-0000-4000-8000-0000000000b2' },
      { eventKey: 'chat-msg-2-129' },
      { conversationId: 22 },
      { customerName: 'Bola' },
      { preview: 'Is it in stock??' },
    ]) {
      expect(
        buildChatEventProof(SECRET, 1_794_730_000, { ...event, ...change })
      ).not.toBe(base);
    }
  });
});

describe('normalizeChatEventText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeChatEventText('  Hello\n\n there\t! ', 280)).toBe(
      'Hello there !'
    );
  });

  it('caps length without splitting an emoji', () => {
    expect(normalizeChatEventText(`${'a'.repeat(279)}😀tail`, 280)).toBe(
      'a'.repeat(279)
    );
  });

  it('treats missing text as empty', () => {
    expect(normalizeChatEventText(null, 80)).toBe('');
    expect(normalizeChatEventText(undefined, 80)).toBe('');
  });
});

describe('recordChatCustomerMessage', () => {
  it('calls the intake function with a fresh proof and returns its outcome', async () => {
    const result = await recordChatCustomerMessage(event, env);

    expect(result).toEqual({ ok: true, outcome: 'notified', duplicate: false });
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe('record_chat_customer_message');
    expect(args).toMatchObject({
      p_merchant_id: event.merchantId,
      p_event_key: 'chat-msg-2-128',
      p_conversation_id: 21,
      p_customer_name: 'Ada',
      p_preview: 'Is it in stock?',
    });
    expect(Math.abs(args.p_issued_at - Date.now() / 1000)).toBeLessThan(5);
    expect(args.p_proof).toBe(
      buildChatEventProof(SECRET, args.p_issued_at, event)
    );
  });

  it('reports a duplicate delivery', async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: 'coalesced', duplicate: true },
      error: null,
    });
    await expect(recordChatCustomerMessage(event, env)).resolves.toEqual({
      ok: true,
      outcome: 'coalesced',
      duplicate: true,
    });
  });

  it.each([
    ['a missing secret', {}],
    ['a short secret', { EKAETTE_CHAT_EVENT_RPC_SECRET: 'short' }],
  ])('does not call the database with %s', async (_label, badEnv) => {
    await expect(
      recordChatCustomerMessage(event, badEnv as unknown as NodeJS.ProcessEnv)
    ).resolves.toEqual({ ok: false, code: 'not_configured' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['a database error', () => ({ data: null, error: { message: 'boom' } })],
    [
      'an unexpected result',
      () => ({ data: { outcome: 'surprise' }, error: null }),
    ],
  ])('is unavailable on %s', async (_label, result) => {
    mocks.rpc.mockResolvedValue(result());
    await expect(recordChatCustomerMessage(event, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('is unavailable when the call throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(recordChatCustomerMessage(event, env)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
