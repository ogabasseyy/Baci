'use client';

import { useMerchantSafe } from '@/hooks/merchant';
import { ChatOrderPanel } from './chat-order-panel';
import { useChatAccountScope } from './use-chat-account-scope';

/** Account records stay in the browser and never enter chat history or models. */
export function ChatOrderActions({ merchantSlug }: { merchantSlug?: string }) {
  const merchant = useMerchantSafe();
  const scope = useChatAccountScope(merchantSlug ?? '');
  if (merchantSlug !== 'ogabassey' || merchant?.merchant?.slug !== merchantSlug)
    return null;
  if (scope.status === 'starting') return <p>Preparing secure order tools…</p>;
  if (scope.status === 'unavailable')
    return (
      <p>
        Secure order tools are unavailable. Please use your account orders page.
      </p>
    );
  return (
    <>
      {scope.cancellationUncertain && (
        <p role="status">
          A cancellation may still be processing. Check your order status before
          trying again.
        </p>
      )}
      <ChatOrderPanel
        key={`${merchantSlug}:${scope.revision}`}
        merchantSlug={merchantSlug}
        basePath={merchant.basePath}
        scope={scope}
      />
    </>
  );
}
