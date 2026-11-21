import { act, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asRoute } from '@/lib/routes';
import { BlackFridayCountdown } from './black-friday-countdown';
import { OgabasseyBlackFridayHomeLink } from './ogabassey-black-friday-home-link';
import {
  BlackFridayHeroDetails,
  BlackFridayOffers,
  OgabasseyBlackFridayPage,
} from './ogabassey-black-friday-page';

const { getBlackFridayProducts } = vi.hoisted(() => ({
  getBlackFridayProducts: vi.fn(),
}));

vi.mock('@/assets/campaigns/black-friday-2026-hero-384.webp', () => ({
  default: {
    src: '/_next/static/media/black-friday-2026-hero-384.test.webp',
    width: 384,
    height: 192,
  },
}));

vi.mock('@/assets/campaigns/black-friday-2026-hero-768.webp', () => ({
  default: {
    src: '/_next/static/media/black-friday-2026-hero-768.test.webp',
    width: 768,
    height: 384,
  },
}));

vi.mock('@/lib/ogabassey-black-friday', () => ({ getBlackFridayProducts }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-label': label,
  }: PropsWithChildren<{ href: string; 'aria-label'?: string }>) => (
    <a aria-label={label} href={href}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  getBlackFridayProducts.mockReset();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Black Friday storefront page', () => {
  it('renders the hero and keeps the placeholder below it while offers load', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T22:00:00Z'));
    getBlackFridayProducts.mockReturnValue(new Promise(() => {}));
    render(<OgabasseyBlackFridayPage pathPrefix="" />);

    expect(
      screen.queryByRole('link', { name: 'Shop the lineup' })
    ).not.toBeInTheDocument();
    expect(getBlackFridayProducts).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('region', { name: 'Black Friday offers' })
    ).toContainElement(document.getElementById('black-friday-offers'));
    expect(screen.getByRole('heading', { name: 'Black Friday' })).toBeVisible();
    expect(screen.getByText('Friday, 27 November 2026')).toHaveAttribute(
      'datetime',
      '2026-11-27T00:00:00+01:00'
    );
    expect(screen.getByRole('timer')).toHaveTextContent('01Hours');
    expect(document.querySelector('header img')).toHaveAttribute(
      'src',
      '/_next/static/media/black-friday-2026-hero-768.test.webp'
    );
    expect(
      screen.getByRole('region', { name: 'Black Friday offers' })
    ).toContainElement(
      screen.getByRole('status', { name: 'Loading Black Friday offers' })
    );
  });

  it('reaches launch at midnight in Lagos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T22:59:59Z'));
    render(<BlackFridayCountdown />);

    expect(screen.getByRole('timer')).toHaveTextContent('01Seconds');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent(
      'Black Friday has started.'
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    false,
    true,
  ])('hides the hero action when the lineup is unavailable (failed: %s)', async (failed) => {
    const lineup = failed
      ? Promise.reject(new Error('catalog unavailable'))
      : Promise.resolve([]);
    render(await BlackFridayHeroDetails({ lineup }));
    expect(
      screen.queryByRole('link', { name: 'Shop the lineup' })
    ).not.toBeInTheDocument();
  });

  it('shows the shop action when the lineup contains offers', async () => {
    const lineup = Promise.resolve([
      {
        id: 'phone',
        name: 'Phone',
        slug: 'phone',
        rawPrice: 1,
        storage: undefined,
        ram: undefined,
        graphics: undefined,
        colors: undefined,
        simType: undefined,
        displayType: undefined,
        displaySize: undefined,
        condition: undefined,
        compareAtPrice: undefined,
        href: asRoute('/phones/phone'),
        price: '₦1',
        priceAmount: 1,
        brand: 'Brand',
        image: '',
      },
    ]);
    render(await BlackFridayHeroDetails({ lineup }));
    expect(
      screen.getByRole('link', { name: 'Shop the lineup' })
    ).toHaveAttribute('href', '#black-friday-offers');
  });

  it('keeps the catalog lineup order for an unsupported sort', async () => {
    getBlackFridayProducts.mockReturnValue(
      Promise.resolve([
        {
          id: '2',
          name: 'Second',
          href: '/phones/second',
          brand: 'Samsung',
          priceAmount: 2,
          price: '₦2',
          compareAtPrice: '₦4',
          image: '/campaigns/black-friday-2026-hero-384.webp',
        },
        {
          id: '1',
          name: 'First',
          brand: 'Apple',
          priceAmount: 1,
          href: '/phones/first',
          price: '₦1',
        },
      ])
    );
    render(
      await BlackFridayOffers({
        pathPrefix: '/ogabassey',
        filters: Promise.resolve({ sort: 'unsupported' }),
      })
    );

    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(['/ogabassey/phones/second', '/ogabassey/phones/first']);
    expect(await screen.findByText('₦4')).toBeVisible();
    const photo = screen
      .getByRole('link', { name: /Second/ })
      .querySelector('img');
    expect(photo?.closest('div')).toHaveStyle({
      position: 'relative',
      aspectRatio: '1',
    });
    expect(photo).toHaveStyle({ objectFit: 'contain' });
  });

  it('filters the curated lineup by brand and maximum price, then sorts by price', async () => {
    getBlackFridayProducts.mockReturnValue(
      Promise.resolve([
        {
          id: '1',
          name: 'Alpha',
          brand: 'Samsung',
          priceAmount: 500,
          href: '/phones/alpha',
          price: '₦500',
        },
        {
          id: '2',
          name: 'Beta',
          brand: 'Apple',
          priceAmount: 200,
          href: '/phones/beta',
          price: '₦200',
        },
        {
          id: '3',
          name: 'Gamma',
          brand: 'Samsung',
          priceAmount: 300,
          href: '/phones/gamma',
          price: '₦300',
        },
        {
          id: '4',
          name: 'Delta',
          brand: 'Samsung',
          priceAmount: 700,
          href: '/phones/delta',
          price: '₦700',
        },
      ])
    );
    render(
      await BlackFridayOffers({
        pathPrefix: '',
        filters: Promise.resolve({
          brand: 'Samsung',
          maxPrice: '500',
          sort: 'price-asc',
        }),
      })
    );
    expect(await screen.findByText('Filter and sort')).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Matching products' });
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.querySelector('h2')?.textContent)
    ).toEqual(['Gamma', 'Alpha']);
  });

  it('filters a mixed lineup by laptop specs without requiring phone specs', async () => {
    getBlackFridayProducts.mockReturnValue(
      Promise.resolve([
        {
          id: 'phone',
          name: 'Phone',
          brand: 'Apple',
          ram: '8 GB',
          storage: '128 GB',
          priceAmount: 400,
          href: '/phones/phone',
          price: '₦400',
        },
        {
          id: 'mac',
          name: 'MacBook',
          brand: 'Apple',
          ram: '16 GB',
          storage: '512 GB',
          priceAmount: 900,
          href: '/laptops/mac',
          price: '₦900',
        },
        {
          id: 'base',
          name: 'Base MacBook',
          brand: 'Apple',
          ram: '16 GB',
          storage: '256 GB',
          priceAmount: 700,
          href: '/laptops/base',
          price: '₦700',
        },
      ])
    );

    render(
      await BlackFridayOffers({
        pathPrefix: '',
        filters: Promise.resolve({ ram: '16 GB', storage: '512 GB' }),
      })
    );

    await screen.findByRole('list', { name: 'Matching products' });
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.querySelector('h2')?.textContent)
    ).toEqual(['MacBook']);
  });

  it('offers a catalog fallback when fetching the campaign lineup fails', async () => {
    getBlackFridayProducts.mockRejectedValue(new Error('catalog unavailable'));
    render(await BlackFridayOffers({ pathPrefix: '/ogabassey' }));
    expect(screen.getByText(/offers couldn’t load/i)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Browse all products' })
    ).toHaveAttribute('href', '/ogabassey/products');
  });

  it('shows the browse link for an empty lineup', async () => {
    getBlackFridayProducts.mockReturnValue(Promise.resolve([]));
    render(await BlackFridayOffers({ pathPrefix: '' }));

    expect(
      await screen.findByRole('link', { name: 'Browse all products' })
    ).toHaveAttribute('href', '/products');
  });

  it('renders the homepage banner and its campaign link without loading the lineup', () => {
    render(<OgabasseyBlackFridayHomeLink pathPrefix="/ogabassey" />);
    expect(
      screen.getByRole('link', { name: 'Shop Black Friday' })
    ).toHaveAttribute('href', '/ogabassey/black-friday');
    expect(getBlackFridayProducts).not.toHaveBeenCalled();
  });
});
