import type { AiChatProvider } from '@/env';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { acceptsAgentUi } from './accepts-agent-ui';
import { withChatTenantHeader } from './chat-tenant';
import { tryFastCatalogResponse } from './fast-catalog-response';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';
import { hasRecentCommerceContext } from './ogabassey-commerce-context';
import { runOgabasseyConversation } from './ogabassey-conversation';
import { buildOgabasseyOrderAction } from './ogabassey-order-action';
import {
  createClientClosedRequestResponse,
  createStaticChatFallbackResponse,
} from './route-helpers';

export async function tryOgabasseyPreferredResponse(
  request: Request,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  tenant: AgenticChatTenant,
  provider: AiChatProvider,
  remainingRouteMs: () => number
): Promise<Response | null> {
  if (tenant.merchantSlug === 'ogabassey' && provider === 'auto') {
    if (request.signal.aborted) {
      return withChatTenantHeader(
        createClientClosedRequestResponse(),
        tenant.merchantSlug
      );
    }
    const action = buildOgabasseyOrderAction(messages);
    if (action) {
      const response = new Response(
        'You can securely view your order and payment status or request a cancellation from your account. Choose an order and confirm before any cancellation.' +
          (acceptsAgentUi(request)
            ? ''
            : '\n\nhttps://ogabassey.com/account/orders'),
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }
      );
      if (request.headers.get('x-baci-chat-order-actions') === '1') {
        response.headers.set('x-baci-chat-action', action);
      }
      return withChatTenantHeader(
        await negotiateChatAgentUiResponse(request, response),
        tenant.merchantSlug
      );
    }
  }

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

  const last = messages.at(-1);
  if (
    last?.role === 'user' &&
    /\b(?:checkout|how\s+(?:do|can|to)\s+(?:i\s+)?pay|payment\s+methods?|bank\s+transfer)\b/i.test(
      last.content
    )
  ) {
    return withChatTenantHeader(
      await negotiateChatAgentUiResponse(
        request,
        new Response(
          'For a new purchase, add the item to your cart and use checkout. For an existing order, check your account orders or contact the store. Please do not send payment details in chat.',
          {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        )
      ),
      tenant.merchantSlug
    );
  }

  if (
    last?.role === 'user' &&
    /\b(?:delivery|shipping)\b/i.test(last.content)
  ) {
    return withChatTenantHeader(
      await negotiateChatAgentUiResponse(
        request,
        new Response(
          'For current delivery options and fees, check checkout with your delivery address or contact the store.',
          {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        )
      ),
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
  const response =
    conversation ??
    (hasRecentCommerceContext(messages)
      ? new Response(
          'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.',
          {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        )
      : createStaticChatFallbackResponse());
  if (response.headers.get('x-baci-chat-fallback') === 'static') {
    console.warn(
      'agentic_chat_provider',
      JSON.stringify({
        event: 'static_fallback',
        reason: conversation ? 'provider_fallback' : 'no_preferred_reply',
        surface: 'ogabassey_conversation',
      })
    );
  }
  if (request.signal.aborted) {
    return withChatTenantHeader(
      createClientClosedRequestResponse(),
      tenant.merchantSlug
    );
  }
  return withChatTenantHeader(
    await negotiateChatAgentUiResponse(request, response),
    tenant.merchantSlug
  );
}
