import React from 'react';

export const StorefrontChatProviderLinks: React.FC<{ conjunction: 'or' | 'and' }> = ({
  conjunction,
}) => (
  <>
    <a
      href="https://openai.com/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      OpenAI
    </a>
    ,{' '}
    <a
      href="https://dev.meta.ai/legal/commitments"
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      Meta
    </a>
    , {conjunction}{' '}
    <a
      href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html"
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      DeepSeek
    </a>
  </>
);

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
