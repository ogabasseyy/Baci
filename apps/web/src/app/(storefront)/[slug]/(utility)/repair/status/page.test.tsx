import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';

const mockLookup = vi.fn();

vi.mock('./repair-status-lookup', () => ({
  RepairStatusLookup: (props: { initialTicket?: string; slug: string }) => {
    mockLookup(props);
    return <div data-slug={props.slug}>lookup form</div>;
  },
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(() => false),
  isValidMerchantIdentifier: vi.fn(() => true),
}));

vi.mock('@/lib/storefront-metadata-title', () => ({
  buildStorefrontMetadataTitle: ({ title }: { title: string }) => ({
    metadataTitle: title,
  }),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: RepairStatusPage, generateMetadata } = await import('./page');

describe('RepairStatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the lookup form for a known store', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValueOnce({
      id: 'm-1',
      business_name: 'Acme Repairs',
    } as never);

    const ui = await RepairStatusPage({
      params: Promise.resolve({ slug: 'Acme' }),
      searchParams: Promise.resolve({ ticket: '1042' }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { name: /Check your repair status/i })
    ).toBeInTheDocument();
    expect(mockLookup).toHaveBeenCalledWith({
      initialTicket: '1042',
      slug: 'acme',
    });
  });

  it('calls notFound for an unknown store', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValueOnce(null as never);

    await expect(
      RepairStatusPage({
        params: Promise.resolve({ slug: 'ghost' }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    ['an array', ['1042']],
    ['non-digits', 'ticket-1042'],
    ['more than ten digits', '12345678901'],
  ])('ignores %s in the ticket query', async (_label, ticket) => {
    vi.mocked(getCachedMerchant).mockResolvedValueOnce({
      id: 'm-1',
      business_name: 'Acme Repairs',
    } as never);

    const ui = await RepairStatusPage({
      params: Promise.resolve({ slug: 'acme' }),
      searchParams: Promise.resolve({ ticket }),
    });
    render(ui);

    expect(mockLookup).toHaveBeenCalledWith({
      initialTicket: undefined,
      slug: 'acme',
    });
  });

  it('marks the status page non-indexable', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValueOnce({
      id: 'm-1',
      business_name: 'Acme Repairs',
    } as never);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'acme' }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
