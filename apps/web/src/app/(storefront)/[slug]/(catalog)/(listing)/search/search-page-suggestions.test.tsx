import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { SearchPageSuggestions } from './search-page-suggestions';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/storefront/search-submission-link', () => ({
  SearchSubmissionLink: ({ children }: { children: string }) => (
    <a href="/search">{children}</a>
  ),
}));

it('links to the selected gift card without requesting a quote', () => {
  render(
    <SearchPageSuggestions
      giftCards={[{ id: '2844', brand: 'PlayStation Store', denomination: 10 }]}
      didYouMean="PlayStation"
      pathPrefix="/ogabassey"
    />
  );
  expect(
    screen.getByRole('link', { name: /PlayStation Store/i })
  ).toHaveAttribute('href', '/ogabassey/gift-cards?selection=2844');
  expect(screen.getByRole('link', { name: 'PlayStation' })).toBeInTheDocument();
});
