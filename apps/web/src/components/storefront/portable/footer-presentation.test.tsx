import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FooterPresentation } from './footer-presentation';

it('renders brand, copyright and children with theme defaults and explicit overrides', () => {
  const { rerender } = render(
    <FooterPresentation brandName="Store" copyrightText="Copyright fixture">
      <a href="/contact">Contact</a>
    </FooterPresentation>
  );
  expect(screen.getByRole('heading', { name: 'Store' })).toBeVisible();
  expect(screen.getByText('Copyright fixture')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute(
    'href',
    '/contact'
  );
  expect(screen.getByRole('contentinfo')).toHaveAttribute(
    'style',
    expect.stringContaining('--theme-footer-bg')
  );
  rerender(
    <FooterPresentation
      brandName="Store"
      copyrightText="Updated"
      backgroundColor="#112233"
      textColor="#ddeeff"
    >
      Child
    </FooterPresentation>
  );
  expect(screen.getByRole('contentinfo')).toHaveStyle({
    backgroundColor: '#112233',
    color: '#ddeeff',
  });
  expect(screen.getByText('Updated')).toBeVisible();
  expect(screen.getByText('Child')).toBeVisible();
});
