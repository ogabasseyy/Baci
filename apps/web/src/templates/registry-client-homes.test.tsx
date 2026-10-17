import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  createDeferredTemplateHome,
  ElectronicsTemplateHome,
  FashionTemplateHome,
} from './registry-client-homes';

describe('registry-client-homes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('renders a local recoverable error fallback when the deferred template import rejects and recovers on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const loadHome = vi
      .fn()
      .mockRejectedValueOnce(new Error('ChunkLoadError'))
      .mockResolvedValueOnce(({ storeSlug }: { storeSlug?: string }) => (
        <div data-testid="recovered-home">{storeSlug}</div>
      ));

    const UnstableTemplateHome = createDeferredTemplateHome(loadHome);
    render(<UnstableTemplateHome storeSlug="retry-store" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load storefront view.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('recovered-home')).toHaveTextContent(
      'retry-store'
    );
    expect(loadHome).toHaveBeenCalledTimes(2);
  });
});
