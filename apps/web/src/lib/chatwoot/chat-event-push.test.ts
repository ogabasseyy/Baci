import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  notify: vi.fn(),
  createStore: vi.fn(() => ({ store: true })),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/expo-push-core', () => ({
  notifyMerchantWithStore: mocks.notify,
}));
vi.mock('@/lib/expo-client', () => ({ getExpoClient: () => ({}) }));
vi.mock('./chat-event-push-store', async (importActual) => {
  const actual: Record<string, unknown> = await importActual();
  return { ...actual, createChatEventPushStore: mocks.createStore };
});

import { sendChatEventPush } from './chat-event-push';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const env = {
  EKAETTE_CHAT_EVENT_RPC_SECRET: SECRET,
} as unknown as NodeJS.ProcessEnv;
const input = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'chat-msg-2-128',
  conversationId: 21,
  customerName: 'Ada',
  preview: 'Is it in stock?',
};

/** Answers the mute switch and the claim separately. */
function answer(preference: unknown, claim: unknown) {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === 'get_chat_message_push_preference' ? preference : claim
  );
}
const claimCall = () =>
  mocks.rpc.mock.calls.find(([name]) => name === 'chat_event_claim_push');

beforeEach(() => {
  vi.clearAllMocks();
  answer({ data: true, error: null }, { data: true, error: null });
  mocks.notify.mockResolvedValue({ sent: 2, failed: 0, errors: [] });
});

describe('sendChatEventPush', () => {
  it('claims the event, then pushes to the store merchant app', async () => {
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'sent',
      sent: 2,
      failed: 0,
    });

    const [name, args] = claimCall() ?? [];
    expect(name).toBe('chat_event_claim_push');
    expect(args).toMatchObject({
      p_merchant_id: input.merchantId,
      p_event_key: 'chat-msg-2-128',
    });
    expect(args.p_claim).toMatch(/^[0-9a-f-]{36}$/);
    // The store is built for the same claim that was taken.
    expect(mocks.createStore).toHaveBeenCalledWith(expect.anything(), SECRET, {
      merchantId: input.merchantId,
      eventKey: 'chat-msg-2-128',
      claim: args.p_claim,
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      { store: true },
      input.merchantId,
      'New message from Ada',
      'Is it in stock?',
      { type: 'customer_message', conversation_id: 21 },
      'general'
    );
  });

  it('uses neutral wording when the customer has no name or text', async () => {
    await sendChatEventPush({ ...input, customerName: '', preview: '' }, env);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.anything(),
      input.merchantId,
      'New customer message',
      'A customer sent a message to your store.',
      expect.anything(),
      'general'
    );
  });

  it('does not push when the claim was already taken', async () => {
    answer({ data: true, error: null }, { data: false, error: null });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'skipped',
      reason: 'already_claimed',
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does not push when the claim call fails', async () => {
    answer(
      { data: true, error: null },
      { data: null, error: { message: 'boom' } }
    );
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'failed',
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('does nothing without a configured secret', async () => {
    await expect(
      sendChatEventPush(input, {} as unknown as NodeJS.ProcessEnv)
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports failed when every delivery was rejected without throwing', async () => {
    mocks.notify.mockResolvedValue({
      sent: 0,
      failed: 2,
      errors: ['Expo request failed'],
    });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'failed',
    });
  });

  it('reports failed when the provider returned errors and nothing was sent', async () => {
    mocks.notify.mockResolvedValue({ sent: 0, failed: 0, errors: ['boom'] });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'failed',
    });
  });

  it('reports a partial delivery when only some devices were reached', async () => {
    mocks.notify.mockResolvedValue({ sent: 1, failed: 1, errors: ['x'] });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'partial',
      sent: 1,
      failed: 1,
    });
  });

  it('treats a store with no registered devices as nothing to deliver, not a failure', async () => {
    mocks.notify.mockResolvedValue({ sent: 0, failed: 0, errors: [] });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'sent',
      sent: 0,
      failed: 0,
    });
  });

  it('reports a failure instead of throwing when delivery throws', async () => {
    mocks.notify.mockRejectedValue(new Error('expo down'));
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'failed',
    });
  });

  it('does not claim or push when the merchant turned chat push off', async () => {
    answer({ data: false, error: null }, { data: true, error: null });
    await expect(sendChatEventPush(input, env)).resolves.toEqual({
      status: 'skipped',
      reason: 'muted',
    });
    expect(claimCall()).toBeUndefined();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('still pushes when the switch cannot be read, so messages are not missed', async () => {
    answer(
      { data: null, error: { message: 'down' } },
      { data: true, error: null }
    );
    await expect(sendChatEventPush(input, env)).resolves.toMatchObject({
      status: 'sent',
    });
  });
});
