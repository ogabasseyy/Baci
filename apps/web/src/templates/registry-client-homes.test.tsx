import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/storefront/templates/gadget-default-template', () => ({
  GadgetDefaultTemplate: ({ storeSlug }: { storeSlug?: string }) => (
    <div data-testid="electronics-home">{storeSlug}</div>
  ),
}));

vi.mock('@/components/storefront/templates/premium-default', () => ({
  PremiumDefaultTemplate: ({ storeSlug }: { storeSlug?: string }) => (
    <div data-testid="fashion-home">{storeSlug}</div>
  ),
}));

import {
  ElectronicsTemplateHome,
  FashionTemplateHome,
} from './registry-client-homes';

describe('registry-client-homes', () => {
  it('lazily resolves and renders the electronics template home on the client boundary', async () => {
    render(<ElectronicsTemplateHome storeSlug="tech-zone" />);

    expect(await screen.findByTestId('electronics-home')).toHaveTextContent(
      'tech-zone'
    );
  });

  it('lazily resolves and renders the fashion template home on the client boundary', async () => {
    render(<FashionTemplateHome storeSlug="luxe-fashion" />);

    expect(await screen.findByTestId('fashion-home')).toHaveTextContent(
      'luxe-fashion'
    );
  });
});
