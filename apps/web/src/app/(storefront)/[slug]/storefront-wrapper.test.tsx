import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merchantContext: {
    merchant: {
      template_id: 'editorial',
      business_name: 'Test Store',
      business_type: 'fashion',
      slug: 'test-store',
    },
    loading: false,
  } as {
    merchant: {
      template_id: string;
      business_name: string;
      business_type: string;
      slug: string;
    } | null;
    loading: boolean;
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => mocks.merchantContext,
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: (templateId: string) => ({
    getComponents: async () => ({
      Home: () => <div data-testid="template-home">{templateId}</div>,
    }),
  }),
  getTemplateIdByBusinessType: () => 'editorial',
}));

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="puck-storefront" />,
}));

vi.mock('@/components/analytics/analytics-provider', () => ({
  AnalyticsProvider: () => null,
}));

vi.mock('@/components/ui/skeletons', () => ({
  StorefrontPageSkeleton: () => <div data-testid="storefront-skeleton" />,
}));

async function importWrapperFresh() {
  vi.resetModules();
  return import('./storefront-wrapper');
}

describe('StorefrontWrapper', () => {
  beforeEach(() => {
    mocks.merchantContext = {
      merchant: {
        template_id: 'editorial',
        business_name: 'Test Store',
        business_type: 'fashion',
        slug: 'test-store',
      },
      loading: false,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('exports a valid component', async () => {
    const { StorefrontWrapper } = await importWrapperFresh();

    expect(StorefrontWrapper).toBeDefined();
    expect(typeof StorefrontWrapper).toBe('function');
  });

  it('renders the registry template home once the registry loads', async () => {
    const { StorefrontWrapper } = await importWrapperFresh();

    render(<StorefrontWrapper />);

    expect(screen.getByTestId('storefront-skeleton')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('template-home')).toHaveTextContent(
        'editorial'
      );
    });
    expect(screen.queryByTestId('storefront-skeleton')).not.toBeInTheDocument();
  });

  it('renders explicit Puck stores without importing the registry chunk', async () => {
    // Regression test: the registry import used to run before the puck
    // branch, so every Puck homepage paid a registry round-trip behind the
    // skeleton. With a rejected registry chunk, the old code still rendered
    // Puck but logged a registry error; the fixed code never imports it.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.merchantContext = {
      merchant: {
        template_id: 'puck',
        business_name: 'Puck Store',
        business_type: 'fashion',
        slug: 'puck-store',
      },
      loading: false,
    };
    vi.resetModules();
    vi.doMock('@/templates/registry', () => {
      throw new Error('registry chunk failed');
    });
    const { StorefrontWrapper } = await import('./storefront-wrapper');

    render(<StorefrontWrapper />);

    await waitFor(() => {
      expect(screen.getByTestId('puck-storefront')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('storefront-skeleton')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    vi.doUnmock('@/templates/registry');
    consoleError.mockRestore();
  });

  it('falls back to Puck when the registry chunk fails to load', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // doMock (not the hoisted static mock) so only this test observes the
    // rejected registry import; resetModules forces the dynamic import to
    // re-resolve through it.
    vi.resetModules();
    vi.doMock('@/templates/registry', () => {
      throw new Error('registry chunk failed');
    });
    const { StorefrontWrapper } = await import('./storefront-wrapper');

    render(<StorefrontWrapper />);

    // The loading state settles into the Puck fallback instead of stranding
    // the page on the skeleton.
    await waitFor(() => {
      expect(screen.getByTestId('puck-storefront')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('storefront-skeleton')).not.toBeInTheDocument();
    vi.doUnmock('@/templates/registry');
    consoleError.mockRestore();
  });
});
