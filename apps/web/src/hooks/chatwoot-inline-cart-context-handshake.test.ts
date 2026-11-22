import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ postChatwootBridgeJson: vi.fn() }));
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request',
  () => ({ postChatwootBridgeJson: mocks.postChatwootBridgeJson })
);

import { handleChatwootInlineContextHandshake } from './chatwoot-inline-cart-context-handshake';

type Message = Parameters<
  typeof handleChatwootInlineContextHandshake
>[0]['message'];
const conversationId = 905;
const requestId = 'request-0001';
const widgetOrigin = 'https://chat.example.com';

function requestMessage(id = requestId): Message {
  return {
    event: 'baci-commerce-context-request',
    data: {
      requestId: id,
      conversationId,
      websiteToken: 'synthetic-widget-token-123456',
      visitorTokenSha256: 'a'.repeat(64),
    },
  } as Message;
}

function readyMessage(): Message {
  return {
    event: 'baci-commerce-context-ready',
    data: {
      requestId,
      conversationId,
      contextToken: 'signed-context-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    },
  } as Message;
}

function input(
  message: Message,
  challenge: { token: string | null; expiresAt: number } = {
    token: null,
    expiresAt: 0,
  }
) {
  let currentChallenge = challenge;
  return {
    begin: vi.fn(),
    getChallenge: () => currentChallenge,
    isCurrent: vi.fn(() => true),
    message,
    post: vi.fn(),
    setAuthorized: vi.fn(),
    ensureCartSession: vi.fn(
      async (): Promise<{ ok: true } | { ok: false } | null> => ({ ok: true })
    ),
    setChallenge: vi.fn((token: string | null, expiresAt: number) => {
      currentChallenge = { token, expiresAt };
    }),
    storeSlug: 'merchant-store',
    widgetOrigin,
  };
}

afterEach(() => vi.clearAllMocks());

describe('handleChatwootInlineContextHandshake', () => {
  it('issues a matching live challenge for the current widget request', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValue({
      requestId,
      widgetOrigin,
      challengeToken: 'signed-challenge-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const value = input(requestMessage());

    await handleChatwootInlineContextHandshake(value);

    expect(value.ensureCartSession).toHaveBeenCalledTimes(1);
    expect(value.begin).toHaveBeenCalledWith(conversationId, requestId);
    expect(value.ensureCartSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.postChatwootBridgeJson.mock.invocationCallOrder[0]
    );
    expect(value.setChallenge).toHaveBeenCalledWith(
      'signed-challenge-token',
      expect.any(Number)
    );
    expect(value.post).toHaveBeenCalledWith(
      'baci-commerce-context-challenge:',
      { requestId, challengeToken: 'signed-challenge-token' }
    );
  });

  it('releases a request that arrived before the storefront cart was ready', async () => {
    const value = input(requestMessage());
    value.isCurrent.mockReturnValue(false);

    await handleChatwootInlineContextHandshake(value);

    expect(value.ensureCartSession).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId,
    });
  });

  it('does not ask the server for a challenge when cart-session provisioning fails', async () => {
    const value = input(requestMessage());
    value.ensureCartSession.mockResolvedValue({ ok: false });

    await handleChatwootInlineContextHandshake(value);

    expect(mocks.postChatwootBridgeJson).not.toHaveBeenCalled();
    expect(value.setChallenge).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId,
    });
  });

  it('does not issue a challenge if the request becomes stale during provisioning', async () => {
    let current = true;
    let finishProvisioning: ((value: { ok: true }) => void) | undefined;
    const value = input(requestMessage());
    value.isCurrent.mockImplementation(() => current);
    value.ensureCartSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishProvisioning = resolve;
        })
    );

    const pending = handleChatwootInlineContextHandshake(value);
    await vi.waitFor(() => expect(finishProvisioning).toBeTypeOf('function'));
    current = false;
    finishProvisioning?.({ ok: true });
    await pending;

    expect(mocks.postChatwootBridgeJson).not.toHaveBeenCalled();
    expect(value.post).not.toHaveBeenCalled();
  });

  it('coalesces overlapping requests but challenges only the current request after provisioning', async () => {
    let activeRequestId: string | null = null;
    let finishProvisioning: ((value: { ok: true }) => void) | undefined;
    // The production ensureCartSession is a single-flight ensureCart: every
    // overlapping caller receives the same in-flight promise.
    const sharedFlight = new Promise<{ ok: true }>((resolve) => {
      finishProvisioning = resolve;
    });
    const ensureCartSession = vi.fn(() => sharedFlight);
    const first = {
      ...input(requestMessage('request-0001')),
      begin: vi.fn((_conversationId: number, id: string) => {
        activeRequestId = id;
      }),
      ensureCartSession,
      isCurrent: vi.fn((_conversationId: number, id: string) =>
        Boolean(activeRequestId === id)
      ),
    };
    const second = {
      ...input(requestMessage('request-0002')),
      begin: first.begin,
      ensureCartSession,
      isCurrent: first.isCurrent,
    };
    mocks.postChatwootBridgeJson.mockImplementation(async (_path, body) => ({
      requestId: body.requestId as string,
      widgetOrigin,
      challengeToken: 'signed-challenge-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }));

    const staleRequest = handleChatwootInlineContextHandshake(first);
    await vi.waitFor(() => expect(finishProvisioning).toBeTypeOf('function'));
    const currentRequest = handleChatwootInlineContextHandshake(second);
    await vi.waitFor(() => expect(ensureCartSession).toHaveBeenCalledTimes(2));
    finishProvisioning?.({ ok: true });
    await Promise.all([staleRequest, currentRequest]);

    expect(mocks.postChatwootBridgeJson).toHaveBeenCalledTimes(1);
    expect(mocks.postChatwootBridgeJson).toHaveBeenCalledWith(
      '/api/storefront/chatwoot/context/challenge',
      expect.objectContaining({ requestId: 'request-0002' }),
      'merchant-store'
    );
    expect(first.post).not.toHaveBeenCalled();
    expect(second.post).toHaveBeenCalledWith(
      'baci-commerce-context-challenge:',
      expect.objectContaining({ requestId: 'request-0002' })
    );
  });

  it('denies an invalid challenge response without authorizing a session', async () => {
    mocks.postChatwootBridgeJson.mockResolvedValue({
      requestId,
      widgetOrigin: 'https://other.example.com',
      challengeToken: 'wrong-origin-token',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    const value = input(requestMessage());

    await handleChatwootInlineContextHandshake(value);

    expect(value.setChallenge).not.toHaveBeenCalled();
    expect(value.setAuthorized).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId,
    });
  });

  it('accepts a verified capability only for the matching active challenge', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    mocks.postChatwootBridgeJson.mockResolvedValue({
      authorized: true,
      requestId,
      conversationId,
      sessionToken: 'signed-session-token',
      sessionExpiresAt: expiresAt,
    });
    const challenge = {
      token: 'signed-challenge-token',
      expiresAt: Date.now() + 60_000,
    };
    const value = input(readyMessage(), challenge);

    await handleChatwootInlineContextHandshake(value);

    expect(value.setAuthorized).toHaveBeenCalledWith(
      'signed-session-token',
      expiresAt * 1000
    );
    expect(value.setChallenge).toHaveBeenCalledWith(null, 0);
    expect(value.post).toHaveBeenCalledWith(
      'baci-commerce-context-authorized:',
      expect.objectContaining({ requestId, conversationId })
    );
  });

  it('does not post a denial when a duplicate verification loses the nonce race', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const resolvers: Array<(value: Record<string, unknown>) => void> = [];
    mocks.postChatwootBridgeJson.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    const value = input(readyMessage(), {
      token: 'signed-challenge-token',
      expiresAt: Date.now() + 60_000,
    });

    const first = handleChatwootInlineContextHandshake(value);
    const second = handleChatwootInlineContextHandshake(value);
    expect(resolvers).toHaveLength(2);

    resolvers[0]?.({
      authorized: true,
      requestId,
      conversationId,
      sessionToken: 'signed-session-token',
      sessionExpiresAt: expiresAt,
    });
    await first;
    resolvers[1]?.({ authorized: false });
    await second;

    expect(value.setAuthorized).toHaveBeenCalledOnce();
    expect(value.post).toHaveBeenCalledTimes(1);
    expect(value.post).toHaveBeenCalledWith(
      'baci-commerce-context-authorized:',
      expect.objectContaining({ requestId, conversationId })
    );
  });

  it('denies verification when the challenge has expired', async () => {
    const value = input(readyMessage(), {
      token: 'expired-challenge-token',
      expiresAt: Date.now() - 1,
    });

    await handleChatwootInlineContextHandshake(value);

    expect(mocks.postChatwootBridgeJson).not.toHaveBeenCalled();
    expect(value.setAuthorized).not.toHaveBeenCalled();
    expect(value.post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId,
    });
  });
});
