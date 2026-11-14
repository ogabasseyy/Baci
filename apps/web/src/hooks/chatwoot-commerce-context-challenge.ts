import { postChatwootBridgeJson } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request';

interface RequestChatwootCommerceContextChallengeInput {
  data: {
    requestId: string;
    conversationId: number;
    websiteToken: string;
    visitorTokenSha256: string;
  };
  storeSlug: string;
  widgetOrigin: string;
  isCurrent: () => boolean;
  post: (prefix: string, value: unknown) => void;
}

export async function requestChatwootCommerceContextChallenge({
  data,
  storeSlug,
  widgetOrigin,
  isCurrent,
  post,
}: RequestChatwootCommerceContextChallengeInput): Promise<{
  challengeToken: string;
  expiresAt: number;
} | null> {
  let challenge: Record<string, unknown> | null;
  try {
    challenge = await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/challenge',
      data,
      storeSlug
    );
  } catch {
    challenge = null;
  }

  const contextStillCurrent = isCurrent();
  if (
    !contextStillCurrent ||
    !challenge ||
    challenge.requestId !== data.requestId ||
    challenge.widgetOrigin !== widgetOrigin ||
    typeof challenge.challengeToken !== 'string' ||
    challenge.challengeToken.length === 0 ||
    challenge.challengeToken.length > 12_000 ||
    typeof challenge.expiresAt !== 'number' ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt * 1000 <= Date.now()
  ) {
    if (contextStillCurrent) {
      post('baci-commerce-context-denied:', { requestId: data.requestId });
    }
    return null;
  }

  post('baci-commerce-context-challenge:', {
    requestId: data.requestId,
    challengeToken: challenge.challengeToken,
  });
  return {
    challengeToken: challenge.challengeToken,
    expiresAt: challenge.expiresAt * 1000,
  };
}
