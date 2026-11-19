import type React from 'react';
import { StorefrontChatProviderLinks } from './storefront-chat-provider-links';

/** Storefront chat disclosure block for the Ogabassey privacy policy page. */
export const StorefrontChatPrivacyDisclosure: React.FC = () => (
  <section className="rounded-xl bg-[var(--ogabassey-surface,#fff)] p-4 text-[var(--ogabassey-surface-text,#111827)] text-sm md:text-base leading-relaxed space-y-2">
    <h2 className="text-xl font-bold mb-3">Storefront chat</h2>
    <p>
      Storefront chat messages may be sent to OpenAI, Meta, or DeepSeek to
      generate responses.
    </p>
    <p>
      We send only your message text and recent conversation context (never
      intentionally account, order, or payment records) under the{' '}
      <StorefrontChatProviderLinks conjunction="and" /> privacy policies.
    </p>
  </section>
);
