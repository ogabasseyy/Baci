import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StorefrontChatPrivacyDisclosure,
  StorefrontChatProviderLinks,
} from './storefront-chat-privacy-disclosure';

describe('StorefrontChatPrivacyDisclosure', () => {
  it('renders subprocessor heading and verified privacy links', () => {
    render(<StorefrontChatPrivacyDisclosure />);

    expect(
      screen.getByRole('heading', { name: 'Storefront chat' })
    ).toBeInTheDocument();
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

  it('supports rendering inline provider links with or conjunction', () => {
    render(<StorefrontChatProviderLinks conjunction="or" />);
    expect(screen.getByText(/or/)).toBeInTheDocument();
  });
});
