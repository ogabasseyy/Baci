import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AddressAutocompleteAttribution } from './address-autocomplete-attribution';

it('shows Geoapify and data-source follow links', () => {
  render(<AddressAutocompleteAttribution provider="geoapify" />);
  expect(screen.getByRole('link', { name: 'Geoapify' })).toHaveAttribute(
    'href',
    'https://www.geoapify.com/'
  );
  expect(screen.getByRole('link', { name: /OpenStreetMap/ })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright'
  );
  expect(screen.getByRole('link', { name: 'Geoapify' })).not.toHaveAttribute(
    'rel',
    expect.stringContaining('nofollow')
  );
});
it('identifies Google predictions correctly', () => {
  render(<AddressAutocompleteAttribution provider="google" />);
  const logo = screen.getByRole('img', { name: 'Powered by Google' });
  expect(logo).toBeVisible();
  expect(logo).toHaveAttribute(
    'src',
    '/attribution/powered-by-google-on-white.png'
  );
  expect(logo).toHaveAttribute('width', '120');
  expect(logo).toHaveAttribute('height', '14');
  expect(logo).not.toHaveClass('opacity-60');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
