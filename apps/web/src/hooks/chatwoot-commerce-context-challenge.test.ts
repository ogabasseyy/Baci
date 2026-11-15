import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postBridge = vi.hoisted(() => vi.fn());
vi.mock(
  '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request',
  () => ({ postChatwootBridgeJson: postBridge })
);

import { requestChatwootCommerceContextChallenge } from './chatwoot-commerce-context-challenge';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const data = {
  requestId: 'req-1',
  conversationId: 7,
  websiteToken: 'site-token',
  visitorTokenSha256: 'a'.repeat(64),
};
const widgetOrigin = 'https://widget.example.com';

function validChallenge(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    widgetOrigin,
    challengeToken: 'challenge-token',
    expiresAt: NOW / 1000 + 60,
    ...overrides,
  };
}

async function run(isCurrent = () => true) {
  const post = vi.fn();
  const result = await requestChatwootCommerceContextChallenge({
    data,
    storeSlug: 'shop',
    widgetOrigin,
    isCurrent,
    post,
  });
  return { post, result };
}

describe('requestChatwootCommerceContextChallenge', () => {
  beforeEach(() => {
    postBridge.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('posts the challenge to the widget and returns it with a ms expiry', async () => {
    postBridge.mockResolvedValue(validChallenge());
    const { post, result } = await run();

    expect(post).toHaveBeenCalledWith('baci-commerce-context-challenge:', {
      requestId: 'req-1',
      challengeToken: 'challenge-token',
    });
    expect(result).toEqual({
      challengeToken: 'challenge-token',
      expiresAt: NOW + 60_000,
    });
  });

  it.each([
    ['expired', { expiresAt: NOW / 1000 - 1 }],
    ['fractional expiry', { expiresAt: NOW / 1000 + 0.5 }],
    ['string expiry', { expiresAt: 'soon' }],
    ['empty token', { challengeToken: '' }],
    ['non-string token', { challengeToken: 123 }],
    ['oversized token', { challengeToken: 'x'.repeat(12_001) }],
    ['other request id', { requestId: 'req-2' }],
    ['other widget origin', { widgetOrigin: 'https://evil.example.com' }],
  ])('denies a malformed or expired challenge: %s', async (_name, change) => {
    postBridge.mockResolvedValue(validChallenge(change));
    const { post, result } = await run();

    expect(result).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId: 'req-1',
    });
  });

  it('denies when the request fails or returns nothing', async () => {
    postBridge.mockRejectedValueOnce(new Error('network'));
    expect((await run()).result).toBeNull();

    postBridge.mockResolvedValueOnce(null);
    const { post, result } = await run();
    expect(result).toBeNull();
    expect(post).toHaveBeenCalledWith('baci-commerce-context-denied:', {
      requestId: 'req-1',
    });
  });

  it('stays silent when a newer request superseded this one', async () => {
    postBridge.mockResolvedValue(validChallenge());
    const { post, result } = await run(() => false);

    expect(result).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('stays silent when a superseded request also fails', async () => {
    postBridge.mockRejectedValue(new Error('network'));
    const { post, result } = await run(() => false);

    expect(result).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
