import type React from 'react';

/** External privacy and commitment links for storefront chat subprocessors. */
export const StorefrontChatProviderLinks: React.FC<{
  conjunction: 'or' | 'and';
}> = ({ conjunction }) => (
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
