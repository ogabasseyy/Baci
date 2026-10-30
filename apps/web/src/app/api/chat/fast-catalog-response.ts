import type { AiChatProvider } from '@/env';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { acceptsAgentUi } from './accepts-agent-ui';
import { withChatTenantHeader } from './chat-tenant';
import { tryFastCatalogChat } from './fast-catalog-flow';
import { formatFastCatalogText } from './fast-catalog-text';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';
import { createClientClosedRequestResponse } from './route-helpers';

export async function tryFastCatalogResponse(
  request: Request,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  tenant: AgenticChatTenant,
  provider: AiChatProvider
): Promise<Response | null> {
  if (provider !== 'auto') return null;
  const reply = await tryFastCatalogChat({
    messages,
    signal: request.signal,
    tenant,
  });
  if (!reply) return null;
  if (request.signal.aborted)
    return withChatTenantHeader(
      createClientClosedRequestResponse(),
      tenant.merchantSlug
    );
  return withChatTenantHeader(
    await negotiateChatAgentUiResponse(
      request,
      new Response(
        acceptsAgentUi(request)
          ? reply.text
          : formatFastCatalogText(reply, tenant.currencyCode),
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            ...(reply.unavailable
              ? { 'x-baci-chat-fallback': 'catalog_unavailable' }
              : {}),
            ...(reply.catalogChecked
              ? { 'x-baci-chat-catalog': 'checked' }
              : {}),
          },
        }
      ),
      reply.events
    ),
    tenant.merchantSlug
  );
}
