import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AddressAutocompleteFeedback } from './address-autocomplete-feedback';

it('retains source attribution alongside manual fallback instructions', () => {
  render(<AddressAutocompleteFeedback provider="geoapify" suggestionsFailed />);
  expect(screen.getByRole('link', { name: 'Geoapify' })).toBeVisible();
  expect(screen.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('manually');
});

it('does not show a failure for an available Google search', () => {
  render(
    <AddressAutocompleteFeedback provider="google" suggestionsFailed={false} />
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
