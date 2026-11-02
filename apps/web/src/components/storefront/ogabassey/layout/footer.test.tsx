import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyFooter } from '@/components/storefront/ogabassey/layout/footer';

vi.mock('./logo', () => ({
  Logo: () => <span>Ogabassey</span>,
}));

vi.mock('../components/Logo', () => ({
  Logo: () => <span>Ogabassey</span>,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe('OgabasseyFooter', () => {
  it('links to the verified official brand profiles', () => {
    render(<OgabasseyFooter storeSlug="/ogabassey" />);

    const expectedProfiles = {
      Instagram: 'https://instagram.com/ogabasseyy',
      Facebook: 'https://www.facebook.com/ogabasseyyy',
      TikTok: 'https://www.tiktok.com/@ogabasseyy',
      'X (formerly Twitter)': 'https://x.com/ogabasseyy',
      YouTube: 'https://www.youtube.com/@ogabassey',
      LinkedIn: 'https://www.linkedin.com/company/ogabasseyy/',
    };

    for (const [name, href] of Object.entries(expectedProfiles)) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });
});
