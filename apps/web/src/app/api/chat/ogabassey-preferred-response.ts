import type { AiChatProvider } from '@/env';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { withChatTenantHeader } from './chat-tenant';
import { tryFastCatalogResponse } from './fast-catalog-response';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';
import { runOgabasseyConversation } from './ogabassey-conversation';
import { createClientClosedRequestResponse } from './route-helpers';

export async function tryOgabasseyPreferredResponse(
  request: Request,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  tenant: AgenticChatTenant,
  provider: AiChatProvider,
  remainingRouteMs: () => number
): Promise<Response | null> {
  const catalog = await tryFastCatalogResponse(
    request,
    messages,
    tenant,
    provider
  );
  if (catalog) return catalog;
  if (tenant.merchantSlug !== 'ogabassey' || provider !== 'auto') return null;
  if (request.signal.aborted) {
    return withChatTenantHeader(
      createClientClosedRequestResponse(),
      tenant.merchantSlug
    );
  }

  const conversation = await runOgabasseyConversation({
    abortSignal: request.signal,
    chatProvider: provider,
    merchantName: tenant.businessName,
    merchantSlug: tenant.merchantSlug,
    messages,
    timeoutMs: remainingRouteMs(),
  });
  if (!conversation) return null;
  if (request.signal.aborted) {
    return withChatTenantHeader(
      createClientClosedRequestResponse(),
      tenant.merchantSlug
    );
  }
  return withChatTenantHeader(
    await negotiateChatAgentUiResponse(request, conversation),
    tenant.merchantSlug
  );
}
