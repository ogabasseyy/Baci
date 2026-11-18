import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorefrontChatProviderLinks } from './storefront-chat-provider-links';

describe('StorefrontChatProviderLinks', () => {
  it('renders verified subprocessor privacy links with the requested conjunction', () => {
    render(<StorefrontChatProviderLinks conjunction="or" />);

    expect(screen.getByText(/or/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute(
      'href',
      'https://openai.com/privacy'
    );
    expect(screen.getByRole('link', { name: 'Meta' })).toHaveAttribute(
      'href',
      'https://dev.meta.ai/legal/commitments'
    );
    expect(screen.getByRole('link', { name: 'DeepSeek' })).toHaveAttribute(
      'href',
      'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html'
    );
  });
});
