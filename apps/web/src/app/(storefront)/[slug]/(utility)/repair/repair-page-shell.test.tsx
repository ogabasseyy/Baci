import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deviceDetail } from './repair-page.test-fixtures';

vi.mock('@/components/storefront/RepairBookingWizard', () => ({
  RepairBookingWizard: () => <div>Repair booking wizard</div>,
}));

vi.mock('@/lib/repairs/repairs-catalog-data', () => ({
  getRepairDeviceDetailBySlug: vi.fn(async () => deviceDetail),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(() => false),
  isValidMerchantIdentifier: vi.fn(() => true),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { default: RepairPage, generateStaticParams } = await import('./page');

describe('RepairPage shell', () => {
  it('prerenders both OgaBassey host identifiers so the booking LCP can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('paints the booking LCP copy without waiting for merchant params', () => {
    render(
      <RepairPage
        params={new Promise(() => undefined)}
        searchParams={new Promise(() => undefined)}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Before you book a repair' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Repair booking wizard')).not.toBeInTheDocument();
  });

  it('keeps the booking wizard off the route module graph', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
      'utf8'
    );

    expect(source).toContain("await import('./repair-page-content')");
    expect(source).not.toMatch(
      /import\s+\{[^}]*RepairPageContent[^}]*\}\s+from\s+['"]\.\/repair-page-content['"]/
    );
  });
});
