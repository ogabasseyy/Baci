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

function requestMessage(): Message {
  return {
    event: 'baci-commerce-context-request',
    data: {
      requestId,
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
  return {
    begin: vi.fn(),
    challenge,
    isCurrent: vi.fn(() => true),
    message,
    post: vi.fn(),
    setAuthorized: vi.fn(),
    setChallenge: vi.fn(),
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

    expect(value.begin).toHaveBeenCalledWith(conversationId, requestId);
    expect(value.setChallenge).toHaveBeenCalledWith(
      'signed-challenge-token',
      expect.any(Number)
    );
    expect(value.post).toHaveBeenCalledWith(
      'baci-commerce-context-challenge:',
      { requestId, challengeToken: 'signed-challenge-token' }
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
