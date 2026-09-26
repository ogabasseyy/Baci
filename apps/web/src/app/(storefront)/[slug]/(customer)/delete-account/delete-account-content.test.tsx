import { render, screen } from '@testing-library/react';
import { headers } from 'next/headers';
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

const { DeleteAccountContent } = await import('./delete-account-content');

describe('Ogabassey account deletion guidance', () => {
  it('keeps the privacy link inside a production path storefront', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(headers).mockResolvedValue(
      new Headers([['host', 'usebaci.com']]) as Awaited<
        ReturnType<typeof headers>
      >
    );
    try {
      vi.mocked(getMerchantByIdentifier).mockResolvedValue({
        business_name: 'Ogabassey',
        email: 'privacy@ogabassey.com',
        logo_url: null,
        slug: 'ogabassey',
      } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);
      render(
        await DeleteAccountContent({
          params: Promise.resolve({ slug: 'ogabassey' }),
        })
      );
      expect(
        screen.getByRole('link', { name: 'Privacy Policy' })
      ).toHaveAttribute('href', '/ogabassey/privacy');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses a root privacy link on the merchant custom domain', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([
        ['host', 'ogabassey.com'],
        ['x-custom-domain', 'ogabassey.com'],
      ]) as Awaited<ReturnType<typeof headers>>
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Ogabassey',
      slug: 'ogabassey',
      custom_domain: 'ogabassey.com',
    } as Awaited<ReturnType<typeof getMerchantByIdentifier>>);
    render(
      await DeleteAccountContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/privacy');
  });

  it('uses the current privacy and tax retention periods instead of 90 days', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['host', 'usebaci.com']]) as Awaited<
        ReturnType<typeof headers>
      >
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Ogabassey',
      email: 'privacy@ogabassey.com',
      logo_url: null,
      slug: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    render(
      await DeleteAccountContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByText(/generally limits storage to six calendar months/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /at least six years after the relevant year of assessment/
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Retained for Legal\/Business Purposes \(90 days\)/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/ogabassey/privacy');
  });
});
