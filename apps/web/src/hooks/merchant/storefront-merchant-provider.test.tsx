import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { useMerchant } from '@/hooks/merchant/use-merchant';

describe('StorefrontMerchantProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('provides server-resolved storefront merchant data without loading state', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'path',
          basePath: '/ogabassey',
          navigationCategories: [{ name: 'Phones', slug: 'phones' }],
        }}
      >
        {children}
      </StorefrontMerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.basePath).toBe('/ogabassey');
    expect(result.current.merchant?.business_name).toBe('Ogabassey');
    expect(result.current.navigationCategories).toEqual([
      { name: 'Phones', slug: 'phones' },
    ]);
  });

  it('uses an empty basePath for domain-routed storefronts', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'domain',
          basePath: '',
          navigationCategories: [],
        }}
      >
        {children}
      </StorefrontMerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.basePath).toBe('');
    expect(result.current.routingMode).toBe('domain');
  });

  it('provides navigationCategories to route content before suspended chrome resolves', () => {
    const suspendedChromePromise = new Promise<never>(() => {
      // Keep chrome suspended to verify content gets first-render categories.
    });

    function SuspendedChrome(): ReactNode {
      throw suspendedChromePromise;
    }

    function RouteContentConsumer() {
      const merchant = useMerchant();

      return (
        <div>{merchant.navigationCategories.map((item) => item.name)}</div>
      );
    }

    render(
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'path',
          basePath: '/ogabassey',
          navigationCategories: [{ name: 'Phones', slug: 'phones' }],
        }}
      >
        <Suspense
          fallback={
            <output aria-label="Loading storefront chrome">chrome</output>
          }
        >
          <SuspendedChrome />
        </Suspense>
        <RouteContentConsumer />
      </StorefrontMerchantProvider>
    );

    expect(
      screen.getByRole('status', { name: 'Loading storefront chrome' })
    ).toBeInTheDocument();
    expect(screen.getByText('Phones')).toBeInTheDocument();
  });

  it('upgrades path server snapshot to domain routing on *.usebaci.com subdomains', () => {
    vi.stubGlobal('window', {
      ...window,
      location: { ...window.location, hostname: 'ogabassey.usebaci.com' },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'path',
          basePath: '/ogabassey',
          navigationCategories: [],
        }}
      >
        {children}
      </StorefrontMerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.routingMode).toBe('domain');
    expect(result.current.basePath).toBe('');
  });

  it('preserves path routing on Vercel preview hostnames', () => {
    vi.stubGlobal('window', {
      ...window,
      location: { ...window.location, hostname: 'baci-preview.vercel.app' },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'path',
          basePath: '/ogabassey',
          navigationCategories: [],
        }}
      >
        {children}
      </StorefrontMerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.routingMode).toBe('path');
    expect(result.current.basePath).toBe('/ogabassey');
  });

  it('preserves server path routing on unknown non-platform hostnames', () => {
    vi.stubGlobal('window', {
      ...window,
      location: { ...window.location, hostname: 'proxy.example.com' },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontMerchantProvider
        shellSnapshot={{
          merchant: {
            id: 'merchant-1',
            user_id: '',
            business_name: 'Ogabassey',
            business_type: 'gadgets',
            slug: 'ogabassey',
          },
          routingMode: 'path',
          basePath: '/ogabassey',
          navigationCategories: [],
        }}
      >
        {children}
      </StorefrontMerchantProvider>
    );

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.routingMode).toBe('path');
    expect(result.current.basePath).toBe('/ogabassey');
  });
});
