import { render, screen, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LaunchProductSlide } from '../components/LaunchCarousel';
import { Hero } from './access-home-hero';
import { OwnershipSections } from './ownership-sections';

vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a {...props} />
  ),
}));
vi.mock('../components/mobile-lcp-hero-image', () => ({
  MobileLcpHeroImage: ({
    alt,
    src,
    shouldPrioritizeImage,
  }: {
    alt: string;
    src: string;
    shouldPrioritizeImage: boolean;
  }) => (
    <img alt={alt} src={src} data-priority={String(shouldPrioritizeImage)} />
  ),
}));
const slide: LaunchProductSlide = {
  kind: 'product',
  id: 'phone',
  name: 'A published device',
  priceLabel: '₦200,000',
  href: '/smartphones/published-device',
  imageUrl: 'https://cdn.ogabassey.com/phone.jpg',
  imageAlt: 'Published phone',
  ctaLabel: 'Shop now',
};

describe('accessible tech homepage', () => {
  it('explains the four benefits before shopping without promising an unverified rate', () => {
    render(<Hero slides={[]} />);
    const benefits = within(
      screen.getByRole('list', { name: 'Why Ogabassey' })
    );
    expect(benefits.getByText('Premium pre-owned')).toBeInTheDocument();
    expect(benefits.getByText('25–40% upfront')).toBeInTheDocument();
    expect(benefits.getByText('Save towards it')).toBeInTheDocument();
    expect(benefits.getByText('Keep tech in use')).toBeInTheDocument();
    expect(benefits.getByText(/3–6 months/)).toBeInTheDocument();
  });
  it('shows the order of ownership for pay-later and save-first paths', () => {
    render(<OwnershipSections />);
    expect(
      screen.getByRole('list', { name: 'Payment plan journey' })
    ).toHaveTextContent(/Pay deposit.*Get device.*Repay monthly/);
    expect(
      screen.getByRole('list', { name: 'Savings journey' })
    ).toHaveTextContent(/Set a goal.*Build savings.*Get device/);
  });

  it('explains the mission and provides scoped shopping and payment navigation', () => {
    render(
      <>
        <Hero slides={[slide]} basePath="/ogabassey" />
        <OwnershipSections basePath="/ogabassey" />
      </>
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Big dreams.'
    );
    expect(
      screen.getByRole('link', { name: 'Find your device' })
    ).toHaveAttribute('href', '/ogabassey/products');
    expect(
      screen.getByRole('link', { name: 'Explore ways to pay' })
    ).toHaveAttribute('href', '/ogabassey#ways-to-own');
    expect(
      screen.getByRole('link', { name: 'Explore your wallet' })
    ).toHaveAttribute('href', '/ogabassey/wallet');
    expect(
      screen.getByRole('link', { name: 'Find your payment plan' })
    ).toHaveAttribute('href', '/ogabassey/contact');
    expect(
      screen.getByRole('link', { name: 'Give your device a second life' })
    ).toHaveAttribute('href', '/ogabassey/repairs');
    const ownership = within(
      screen.getByRole('region', { name: 'More ways to make it yours.' })
    );
    expect(ownership.getByText(/25–40%/)).toBeInTheDocument();
    expect(ownership.getByText(/3–6 months/)).toBeInTheDocument();
    expect(screen.getByText(/not all wallet balances/)).toBeInTheDocument();
  });
  it('uses the published product and prioritises only its mobile LCP image', () => {
    render(<Hero slides={[slide]} />);
    expect(
      screen.getByRole('link', { name: 'A published device — Shop now' })
    ).toHaveAttribute('href', slide.href);
    expect(screen.getAllByAltText('Published phone')[0]).toHaveAttribute(
      'data-priority',
      'true'
    );
    expect(screen.getByText('₦200,000')).toBeInTheDocument();
  });
  it('keeps a useful brand hero with no invented product when the feed is empty', () => {
    render(<Hero slides={[]} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Find your device' })
    ).toHaveAttribute('href', '/products');
    expect(
      within(screen.getByRole('navigation')).getAllByRole('link')
    ).toHaveLength(4);
  });
  it('honours the upstream document heading and the alternate mobile layout', () => {
    const { container } = render(
      <Hero slides={[]} omitDocumentHeading omitMobileCarousel />
    );
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(container.querySelector('[data-ogabassey-access-hero]')).toHaveClass(
      'oa-hide-mobile'
    );
  });
  it('reserves the same hero structure without exposing product data or navigation', () => {
    const { container } = render(
      <Hero slides={[slide]} reserve omitDocumentHeading />
    );
    expect(
      container.querySelector('[data-ogabassey-access-hero]')
    ).toHaveAttribute('inert');
    expect(
      container.querySelector('[data-ogabassey-access-hero]')
    ).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('a, button, img')).toBeNull();
    expect(container).not.toHaveTextContent('A published device');
    expect(container.querySelector('.oa-hero')).not.toBeNull();
  });
});
