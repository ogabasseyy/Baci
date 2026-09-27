import { describe, expect, it, vi } from 'vitest';
import { getMerchantByIdentifier } from '@/lib/cached-data';

vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers([['host', 'usebaci.com']])),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn(() => '{}'),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn(() => null),
}));

vi.mock('next/link', () => ({
  default: vi.fn(
    ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    )
  ),
}));

const { generateMetadata } = await import('./page');

describe('delete-account metadata', () => {
  it('returns fallback title when merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'unknown' }),
    });

    expect(metadata.title).toBe('Delete Account');
  });

  it('returns merchant-specific title when merchant exists', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      logo_url: null,
      slug: 'test-store',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.title).toBe('Delete Account | Test Store');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
