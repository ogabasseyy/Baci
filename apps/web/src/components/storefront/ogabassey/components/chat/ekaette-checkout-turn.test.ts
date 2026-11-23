import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';
import { createEkaetteCheckoutTurnLookup } from './ekaette-checkout-turn';

vi.mock('./chatwoot-bridge-request', () => ({
  postChatwootBridgeJson: vi.fn(),
}));

const REQ_1 = '60000000-0000-4000-8000-000000000011';
const REQ_2 = '60000000-0000-4000-8000-000000000012';

const command = (payload: Record<string, unknown>) =>
  `baci-ekaette-checkout-turn:${JSON.stringify({
    requestId: REQ_1,
    conversationId: 42,
    sessionToken: 'session-tok',
    step: 'device_protection',
    question: 'Would you like to keep Ogabassey Assurance?',
    answer: 'Yes please',
    ...payload,
  })}`;

describe('createEkaetteCheckoutTurnLookup', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('forwards valid checkout turn responses and ignores malformed commands', async () => {
    const lookup = createEkaetteCheckoutTurnLookup('savings-synthetic');
    const post = vi.fn();

    await lookup.receive('other-prefix:{}', post);
    await lookup.receive('baci-ekaette-checkout-turn:{bad', post);
    expect(post).not.toHaveBeenCalled();

    vi.mocked(postChatwootBridgeJson).mockResolvedValueOnce({
      intent: 'confirm',
      reply: 'Great, keeping Ogabassey Assurance included.',
    });
    await lookup.receive(command({}), post);
    expect(post).toHaveBeenCalledWith({
      requestId: REQ_1,
      status: 'ok',
      intent: 'confirm',
      reply: 'Great, keeping Ogabassey Assurance included.',
    });
  });

  it('reports unavailable on malformed payloads or errors and drops results after close()', async () => {
    const lookup = createEkaetteCheckoutTurnLookup('savings-synthetic');
    const post = vi.fn();

    vi.mocked(postChatwootBridgeJson)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('timeout'));

    await lookup.receive(command({}), post);
    expect(post).toHaveBeenLastCalledWith({
      requestId: REQ_1,
      status: 'unavailable',
    });

    await lookup.receive(command({}), post);
    expect(post).toHaveBeenLastCalledWith({
      requestId: REQ_1,
      status: 'unavailable',
    });

    post.mockClear();
    let resolvePending:
      | ((v: Record<string, unknown> | null) => void)
      | undefined;
    vi.mocked(postChatwootBridgeJson).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        })
    );
    const req = lookup.receive(command({ requestId: REQ_2 }), post);
    lookup.close();
    resolvePending?.({ intent: 'confirm' });
    await req;
    expect(post).not.toHaveBeenCalled();
  });
});
