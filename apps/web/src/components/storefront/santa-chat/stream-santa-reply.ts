import type { Dispatch, SetStateAction } from 'react';
import { readSantaMerchantSlug } from './read-santa-merchant-slug';
import { parseSantaActions } from './types';

export interface SantaDialogMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

export interface StreamSantaReplyOptions {
  updatedMessages: SantaDialogMessage[];
  abortControllerRef: { current: AbortController | null };
  processedActionsRef: { current: Set<string> };
  setMessages: Dispatch<SetStateAction<SantaDialogMessage[]>>;
  onCartAction: (
    productName: string,
    price: number,
    replyMerchantSlug: string | null
  ) => Promise<void>;
  expectedMerchantSlug?: string | null;
  onMerchantSlug: (merchantSlug: string) => void;
}

// Module-scope helper: keeps throw-in-try out of the component body so
// React Compiler can memoize SantaChatDialog.
export async function streamSantaReply({
  updatedMessages,
  abortControllerRef,
  processedActionsRef,
  setMessages,
  onCartAction,
  expectedMerchantSlug,
  onMerchantSlug,
}: StreamSantaReplyOptions): Promise<void> {
  // Cancel any previous in-flight request
  abortControllerRef.current?.abort();
  const controller = new AbortController();
  abortControllerRef.current = controller;

  const response = await fetch('/api/chat/santa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(expectedMerchantSlug
        ? { 'x-baci-storefront-slug': expectedMerchantSlug }
        : {}),
    },
    signal: controller.signal,
    body: JSON.stringify({
      messages: updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
        imageUrl: m.imageUrl,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get response from Santa');
  }

  // Adopt only the server-attested tenant; cart actions below refuse to run
  // against a different storefront.
  const merchantSlug = readSantaMerchantSlug(response);
  if (merchantSlug) {
    onMerchantSlug(merchantSlug);
  }

  // Handle streaming response
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let assistantContent = '';
  const assistantId = `assistant-${Date.now()}`;

  // Add empty assistant message
  setMessages((prev) => [
    ...prev,
    { id: assistantId, role: 'assistant', content: '' },
  ]);

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // toTextStreamResponse() returns raw UTF-8 text chunks
      assistantContent += chunk;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: assistantContent } : m
        )
      );
    }

    // After streaming completes, check for cart actions. Process every
    // directive once so display stripping cannot hide unfulfilled wishes.
    const actions = parseSantaActions(assistantContent);
    if (actions.length > 0 && !processedActionsRef.current.has(assistantId)) {
      processedActionsRef.current.add(assistantId);
      const actionResults = await Promise.allSettled(
        actions.map((action) =>
          onCartAction(action.productName, action.price, merchantSlug)
        )
      );

      actionResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const action = actions[index];
          console.error('[Santa Cart] Action failed:', {
            productName: action?.productName,
            price: action?.price,
            reason: result.reason,
          });
        }
      });
    }
  }
}
