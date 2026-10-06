import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';
import { isValidMerchantIdentifier } from '@/lib/validation';

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));

vi.mock('@/lib/validation', () => ({
  isValidMerchantIdentifier: vi.fn(() => true),
  isDomainIdentifier: vi.fn(() => false),
}));

vi.mock('@/components/storefront/ogabassey/pages/wallet', () => ({
  OgabasseyV2Wallet: ({
    initialShowFunding,
  }: {
    initialShowFunding?: boolean;
  }) => (
    <div
      data-initial-show-funding={String(initialShowFunding ?? false)}
      data-testid="wallet"
    >
      Wallet UI
    </div>
  ),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: WalletPage, metadata } = await import('./page');

describe('WalletPage', () => {
  it('contains its own Suspense boundary before reading runtime search parameters', () => {
    const page = WalletPage({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({ fund: '1' }),
    });
    expect(page.type).toBe(Suspense);
    render(page.props.fallback);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Preparing your wallet'
    );
  });
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(true);
    notFound.mockClear();
  });

  it('does not render a page-owned loading fallback while content loads', () => {
    vi.mocked(getCachedMerchant).mockReturnValue(
      new Promise(() => {
        /* deferred: keep Suspense pending */
      })
    );

    render(
      <Suspense fallback={null}>
        <WalletPage params={Promise.resolve({ slug: 'test-store' })} />
      </Suspense>
    );

    expect(screen.queryByText('Loading wallet...')).toBeNull();
  });

  it('triggers notFound when merchant does not exist', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue(null);

    render(
      <Suspense fallback={null}>
        <WalletPage params={Promise.resolve({ slug: 'missing' })} />
      </Suspense>
    );

    // Wait for the async WalletContent to resolve and call notFound
    await vi.waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
  });

  it('does not call notFound for valid ogabassey merchant', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
      slug: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(
      <Suspense fallback={null}>
        <WalletPage params={Promise.resolve({ slug: 'ogabassey' })} />
      </Suspense>
    );

    // Async RSC content streams via Suspense which jsdom can't resolve,
    // so verify the correct code path via function call assertions
    await vi.waitFor(() => {
      expect(getCachedMerchant).toHaveBeenCalledWith('ogabassey');
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('triggers notFound for non-ogabassey template', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'default',
      slug: 'other-store',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(
      <Suspense fallback={null}>
        <WalletPage params={Promise.resolve({ slug: 'other-store' })} />
      </Suspense>
    );

    await vi.waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
  });

  it('triggers notFound for invalid slug', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(false);

    render(
      <Suspense fallback={null}>
        <WalletPage params={Promise.resolve({ slug: 'invalid!!slug' })} />
      </Suspense>
    );

    await vi.waitFor(() => {
      expect(notFound).toHaveBeenCalled();
    });
  });

  it('marks the customer wallet page as non-indexable', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
