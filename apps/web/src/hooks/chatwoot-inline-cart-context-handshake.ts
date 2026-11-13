import { postChatwootBridgeJson } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request';
import type { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';

type ContextMessage = NonNullable<
  ReturnType<typeof readChatwootCommerceContextMessage>
>;
type RequestMessage = Extract<
  ContextMessage,
  { event: 'baci-commerce-context-request' }
>;
type ReadyMessage = Extract<
  ContextMessage,
  { event: 'baci-commerce-context-ready' }
>;
type Post = (prefix: string, value: unknown) => void;

type HandshakeInput<Message extends ContextMessage> = {
  message: Message;
  storeSlug: string;
  widgetOrigin: string;
  post: Post;
  isCurrent: (conversationId: number, requestId: string) => boolean;
  begin: (conversationId: number, requestId: string) => void;
  getChallenge: () => { token: string | null; expiresAt: number };
  setChallenge: (token: string | null, expiresAt: number) => void;
  setAuthorized: (token: string, expiresAt: number) => void;
};

export async function handleChatwootInlineContextHandshake(
  input: HandshakeInput<ContextMessage>
) {
  if (input.message.event === 'baci-commerce-context-request') {
    await issueChallenge(input as HandshakeInput<RequestMessage>);
  } else {
    await verifyContext(input as HandshakeInput<ReadyMessage>);
  }
}

async function issueChallenge(input: HandshakeInput<RequestMessage>) {
  const { requestId, conversationId } = input.message.data;
  input.begin(conversationId, requestId);
  let challenge: Record<string, unknown> | null;
  try {
    challenge = await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/challenge',
      input.message.data,
      input.storeSlug
    );
  } catch {
    challenge = null;
  }
  const current = input.isCurrent(conversationId, requestId);
  if (
    !current ||
    !challenge ||
    challenge.requestId !== requestId ||
    challenge.widgetOrigin !== input.widgetOrigin ||
    typeof challenge.challengeToken !== 'string' ||
    challenge.challengeToken.length === 0 ||
    challenge.challengeToken.length > 12_000 ||
    typeof challenge.expiresAt !== 'number' ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt * 1000 <= Date.now()
  ) {
    if (current) input.post('baci-commerce-context-denied:', { requestId });
    return;
  }
  input.setChallenge(challenge.challengeToken, challenge.expiresAt * 1000);
  input.post('baci-commerce-context-challenge:', {
    requestId,
    challengeToken: challenge.challengeToken,
  });
}

async function verifyContext(input: HandshakeInput<ReadyMessage>) {
  const { requestId, conversationId, contextToken, expiresAt } =
    input.message.data;
  const challenge = input.getChallenge();
  const challengeToken = challenge.token;
  if (
    !input.isCurrent(conversationId, requestId) ||
    !challengeToken ||
    challenge.expiresAt <= Date.now() ||
    expiresAt * 1000 <= Date.now()
  ) {
    input.post('baci-commerce-context-denied:', { requestId });
    return;
  }
  let verified: Record<string, unknown> | null;
  try {
    verified = await postChatwootBridgeJson(
      '/api/storefront/chatwoot/context/verify',
      { challengeToken, contextToken },
      input.storeSlug
    );
  } catch {
    verified = null;
  }
  const latestChallenge = input.getChallenge();
  const challengeStillCurrent =
    latestChallenge.token === challengeToken &&
    latestChallenge.expiresAt > Date.now();
  if (
    !input.isCurrent(conversationId, requestId) ||
    !challengeStillCurrent ||
    !verified ||
    verified.authorized !== true ||
    verified.requestId !== requestId ||
    verified.conversationId !== conversationId ||
    typeof verified.sessionToken !== 'string' ||
    verified.sessionToken.length === 0 ||
    verified.sessionToken.length > 12_000 ||
    typeof verified.sessionExpiresAt !== 'number' ||
    !Number.isSafeInteger(verified.sessionExpiresAt) ||
    verified.sessionExpiresAt * 1000 <= Date.now()
  ) {
    if (input.isCurrent(conversationId, requestId) && challengeStillCurrent) {
      input.post('baci-commerce-context-denied:', { requestId });
    }
    return;
  }
  input.setAuthorized(verified.sessionToken, verified.sessionExpiresAt * 1000);
  input.setChallenge(null, 0);
  input.post('baci-commerce-context-authorized:', {
    requestId,
    conversationId,
    sessionToken: verified.sessionToken,
    sessionExpiresAt: verified.sessionExpiresAt,
  });
}
