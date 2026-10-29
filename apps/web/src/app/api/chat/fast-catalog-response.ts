import type { AiChatProvider } from '@/env';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { withChatTenantHeader } from './chat-tenant';
import { tryFastCatalogChat } from './fast-catalog-flow';
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
      new Response(reply.text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
      reply.events
    ),
    tenant.merchantSlug
  );
}
