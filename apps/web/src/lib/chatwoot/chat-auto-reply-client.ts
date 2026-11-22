import 'server-only';

import { z } from 'zod';
import type { ChatAutoReplyProduct } from '@/ai/chat-auto-reply';
import type { ChatSuggestion } from '@/schemas/chat-auto-reply';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';

const REQUEST_TIMEOUT_MS = 5_000;

async function providerPost(
  binding: ChatAutoReplyBinding,
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<boolean> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  try {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        api_access_token: token,
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only: never the token, message text or response body.
      console.error('[chat-auto-reply] provider request failed', {
        status: response.status,
        path: path.replace(/\/\d+/g, '/:id'),
      });
    }
    return response.ok;
  } catch {
    console.error('[chat-auto-reply] provider request failed', {
      status: null,
      path: path.replace(/\/\d+/g, '/:id'),
    });
    return false;
  }
}

/** Posts as the assistant bot: a public reply, or a private staff note. */
export function postAssistantMessage(
  binding: ChatAutoReplyBinding,
  input: {
    conversationId: number;
    content: string;
    isPrivate?: boolean;
    cards?: readonly ChatAutoReplyProduct[];
    cartAction?: {
      for_message_id: number;
      slug: string;
      options: readonly { axis: string; value: string }[];
    };
    checkoutName?: {
      for_message_id: number;
      firstName: string;
      lastName: string;
    };
    followUps?: { for_message_id: number; actions: readonly ChatSuggestion[] };
  }
): Promise<boolean> {
  return providerPost(
    binding,
    `/conversations/${input.conversationId}/messages`,
    binding.botApiAccessToken,
    {
      content: input.content,
      message_type: 'outgoing',
      private: input.isPrivate === true,
      ...(input.cards?.length
        ? {
            content_type: 'cards',
            content_attributes: {
              ...(input.cards.some((card) => card.initialProduct)
                ? {
                    ekaette_product_options: {
                      prepared_at: Date.now(),
                      products: input.cards.flatMap((card) =>
                        card.initialProduct ? [card.initialProduct] : []
                      ),
                    },
                  }
                : {}),
              ...(input.cartAction
                ? { ekaette_cart_action: input.cartAction }
                : {}),
              items: input.cards.map((card) => ({
                title: card.name,
                ...(card.imageUrl ? { media_url: card.imageUrl } : {}),
                description: [card.brand ?? '', card.priceLabel ?? ''].join(
                  '\n'
                ),
                actions: [
                  ...(card.productPath
                    ? [
                        {
                          type: 'link',
                          text: 'View product',
                          uri: card.productPath,
                          payload: 'baci-storefront-product',
                        },
                      ]
                    : []),
                  ...(card.storefrontOnly
                    ? []
                    : [
                        {
                          type: 'postback',
                          text: 'Options',
                          payload: `product:${card.slug}`,
                        },
                      ]),
                ],
              })),
            },
          }
        : input.followUps || input.checkoutName
          ? {
              content_attributes: {
                ...(input.followUps
                  ? { ekaette_follow_ups: input.followUps }
                  : {}),
                ...(input.checkoutName
                  ? { ekaette_checkout_name: input.checkoutName }
                  : {}),
              },
            }
          : {}),
    }
  );
}

/** Moves a conversation to a person's queue (`open`) or back (`pending`). */
export function setConversationStatus(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; status: 'open' | 'pending' }
): Promise<boolean> {
  return providerPost(
    binding,
    `/conversations/${input.conversationId}/toggle_status`,
    binding.botApiAccessToken,
    { status: input.status }
  );
}

/** Replaces the conversation's whole label list (merge before calling). */
export function setConversationLabels(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; labels: string[] }
): Promise<boolean> {
  return providerPost(
    binding,
    `/conversations/${input.conversationId}/labels`,
    binding.apiAccessToken,
    { labels: input.labels }
  );
}

const conversationSnapshotSchema = z.object({
  status: z.string(),
  labels: z.array(z.string()).max(50).default([]),
});

export type ConversationSnapshot = { status: string; labels: string[] };

/**
 * The conversation's live status and labels. A webhook snapshot can be stale
 * by the time the assistant acts, so decisions that must not talk over a
 * person or drop a label read this first. Null when it cannot be read.
 */
export async function getConversationSnapshot(
  binding: ChatAutoReplyBinding,
  conversationId: number
): Promise<ConversationSnapshot | null> {
  const path = `/conversations/${conversationId}`;
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[chat-auto-reply] provider request failed', {
        status: response.status,
        path: '/conversations/:id',
      });
      return null;
    }
    const parsed = conversationSnapshotSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    console.error('[chat-auto-reply] provider request failed', {
      status: null,
      path: '/conversations/:id',
    });
    return null;
  }
}
