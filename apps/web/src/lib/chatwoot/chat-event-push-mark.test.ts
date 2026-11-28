import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { markChatEventPushDispatch } from './chat-event-push-mark';

const SECRET = 'synthetic-chat-event-secret-0123456789abcdef';
const scope = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'fu-5f2d3c1e8a474b699c0e1a2b3c4d5e6f',
  claim: '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f',
};
const run = (answer: unknown) => {
  const rpc = vi.fn().mockResolvedValue(answer);
  const client = { rpc } as unknown as Parameters<
    typeof markChatEventPushDispatch
  >[0];
  return { rpc, done: markChatEventPushDispatch(client, SECRET, scope) };
};

describe('markChatEventPushDispatch', () => {
  it('records that sending began, with a proof for this claim', async () => {
    const { rpc, done } = run({ data: true, error: null });
    await expect(done).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'chat_event_mark_push_dispatch',
      expect.objectContaining({
        p_merchant_id: scope.merchantId,
        p_event_key: scope.eventKey,
        p_claim: scope.claim,
        p_proof: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
  });

  it.each([
    ['the claim is gone', { data: false, error: null }],
    ['the database call fails', { data: null, error: { message: 'down' } }],
  ])('throws, so nothing is sent, when %s', async (_label, answer) => {
    await expect(run(answer).done).rejects.toThrow(
      'chat push dispatch was not recorded'
    );
  });
});
