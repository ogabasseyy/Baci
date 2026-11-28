import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/expo-push-core', () => ({
  notifyMerchantWithStore: mocks.notify,
}));
vi.mock('@/lib/expo-push-lazy-client', () => ({
  createLazyExpoGetter: () => () => ({}),
}));

import { sendChatEventPush } from './chat-event-push';

const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: 'synthetic-chat-event-secret-0123456789abcdef',
} as unknown as NodeJS.ProcessEnv;
const input = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'fu-0123456789abcdef0123456789abcdef',
  conversationId: 21,
  customerName: 'Ada',
  preview: '',
  kind: 'follow_up' as const,
};

let handedToProvider = false;
/** Stands in for delivery: runs the delivery-start hook, then "sends". */
const deliver = async (...args: unknown[]) => {
  await (args[6] as { onDeliveryStart: () => void }).onDeliveryStart();
  handedToProvider = true;
  return { sent: 1, failed: 0, errors: [] };
};
const marks = () =>
  mocks.rpc.mock.calls.filter(
    ([name]) => name === 'chat_event_mark_push_dispatch'
  );

beforeEach(() => {
  vi.clearAllMocks();
  handedToProvider = false;
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.notify.mockImplementation(deliver);
});

describe('bugfix: a run stopped just before sending lost the follow-up', () => {
  it('records that sending began before a follow-up push goes out', async () => {
    await sendChatEventPush(input, env);
    expect(marks()).toHaveLength(1);
    expect(handedToProvider).toBe(true);
  });

  it('adds no such step to a message push', async () => {
    await sendChatEventPush({ ...input, kind: 'message' }, env);
    expect(marks()).toHaveLength(0);
  });

  it('sends nothing, and says so, when that record cannot be written', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name !== 'chat_event_mark_push_dispatch',
      error: null,
    }));
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'failed',
      nothingSent: true,
    });
    expect(handedToProvider).toBe(false);
  });
});
