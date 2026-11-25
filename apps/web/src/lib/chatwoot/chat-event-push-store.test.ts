import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/expo-push-lazy-client', () => ({
  createLazyExpoGetter: () => () => ({ expo: true }),
}));

import {
  buildChatEventPushProof,
  type ChatEventPushAction,
  createChatEventPushStore,
} from './chat-event-push-store';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const scope = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'chat-msg-2-128',
  claim: 'c4a71000-0000-4000-8000-0000000000c1',
};
const rpc = vi.fn();

function store() {
  return createChatEventPushStore({ rpc } as never, SECRET, scope);
}

/** The proof must be the one the database recomputes for that action. */
function expectScoped(
  args: Record<string, unknown>,
  action: ChatEventPushAction
) {
  expect(args).toMatchObject({
    p_merchant_id: scope.merchantId,
    p_event_key: scope.eventKey,
    p_claim: scope.claim,
  });
  expect(args.p_proof).toBe(
    buildChatEventPushProof(SECRET, args.p_issued_at as number, scope, action)
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe('buildChatEventPushProof', () => {
  it('matches the proof the database wrappers compute', () => {
    // Vector produced by the SQL used in private.chat_event_push_lease.
    expect(
      buildChatEventPushProof(SECRET, 1_794_730_000, scope, 'tokens')
    ).toBe('99f339e1fcc9e5ca03230d0f5ea96e52738fc8c3659c401301e5f63e43af86c1');
  });

  it('is bound to the action', () => {
    const actions: ChatEventPushAction[] = [
      'claim',
      'tokens',
      'tickets',
      'deactivate',
      'attempt',
    ];
    const proofs = actions.map((action) =>
      buildChatEventPushProof(SECRET, 1_794_730_000, scope, action)
    );
    expect(new Set(proofs).size).toBe(5);
  });
});

describe('createChatEventPushStore', () => {
  it('reads tokens through the claimed-event wrapper, ignoring caller ids', async () => {
    rpc.mockResolvedValue({
      data: [{ token: 'ExponentPushToken[a]', platform: 'ios' }],
      error: null,
    });
    const result = await store().fetchMerchantTokens({
      merchantId: 'some-other-merchant',
      recipientUserIds: ['someone'],
    });
    expect(result).toEqual({
      data: [{ token: 'ExponentPushToken[a]', platform: 'ios' }],
      error: null,
    });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('chat_event_push_tokens');
    expectScoped(args, 'tokens');
    expect(JSON.stringify(args)).not.toContain('some-other-merchant');
  });

  it('reports a token read failure without database detail', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation x' } });
    await expect(
      store().fetchMerchantTokens({ merchantId: scope.merchantId })
    ).resolves.toEqual({
      data: null,
      error: { message: 'Chat push tokens unavailable' },
    });
  });

  it('reports malformed token rows as the same sanitized read error', async () => {
    rpc.mockResolvedValue({
      data: [{ token: 'ExponentPushToken[a]' }],
      error: null,
    });
    await expect(
      store().fetchMerchantTokens({ merchantId: scope.merchantId })
    ).resolves.toEqual({
      data: null,
      error: { message: 'Chat push tokens unavailable' },
    });
  });

  it('never serves customer tokens', async () => {
    await expect(store().fetchCustomerTokens({ userId: 'u' })).resolves.toEqual(
      { data: [], error: null }
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stores tickets with only the token and ticket id', async () => {
    await store().insertTickets([
      {
        ticket_id: 't1',
        push_token: 'ExponentPushToken[a]',
        merchant_id: 'ignored',
        user_id: 'ignored',
        app_type: 'storefront',
        channel: 'general',
        notification_type: 'customer_message',
        status: 'pending',
      },
    ]);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('chat_event_store_push_tickets');
    expectScoped(args, 'tickets');
    expect(args.p_tickets).toEqual([
      { push_token: 'ExponentPushToken[a]', ticket_id: 't1' },
    ]);
  });

  it('deactivates tokens through the scoped wrapper', async () => {
    await store().deactivateTokens('DeviceNotRegistered', [
      'ExponentPushToken[a]',
    ]);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('chat_event_deactivate_push_tokens');
    expectScoped(args, 'deactivate');
    expect(args).toMatchObject({
      p_reason: 'DeviceNotRegistered',
      p_tokens: ['ExponentPushToken[a]'],
    });
  });

  it('records the attempt without any customer text', async () => {
    await store().insertAttempt({
      merchant_id: scope.merchantId,
      user_id: null,
      app_type: 'admin',
      channel: 'general',
      notification_type: 'customer_message',
      title: 'New message from Ada',
      body: 'my card number is 1234',
      payload: { type: 'customer_message' },
      token_count: 2,
      sent_count: 1,
      failed_count: 1,
      status: 'partial_failure',
      errors: ['DeviceNotRegistered'],
    });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('chat_event_record_push_attempt');
    expectScoped(args, 'attempt');
    expect(args.p_attempt).toEqual({
      status: 'partial_failure',
      token_count: 2,
      sent_count: 1,
      failed_count: 1,
      errors: ['DeviceNotRegistered'],
    });
    expect(JSON.stringify(args)).not.toContain('card number');
  });

  it.each([
    [
      'a database error',
      { data: null, error: { message: 'boom' } },
      'Chat push store write failed',
    ],
    [
      'a lost claim',
      { data: false, error: null },
      'Chat push claim is no longer active',
    ],
  ])('surfaces %s as a write error', async (_label, response, message) => {
    rpc.mockResolvedValue(response);
    await expect(store().deactivateTokens('x', ['t'])).resolves.toEqual({
      error: { message },
    });
  });
});
