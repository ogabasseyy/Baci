import { fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, createRef, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { AddressAutocompleteDropdown } from './address-autocomplete-dropdown';

// Test suggestion behavior without waiting for browser animation frames.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: ComponentProps<'div'> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props} />,
  },
}));

const prediction = {
  placeId: 'place',
  mainText: 'Allen Avenue',
  secondaryText: 'Ikeja',
  fullText: 'Allen Avenue, Ikeja',
};
it('shows provider predictions and forwards the selected address', () => {
  const onSelect = vi.fn();
  render(
    <AddressAutocompleteDropdown
      isOpen
      predictions={[prediction]}
      highlightedIndex={0}
      dropdownRef={createRef()}
      onSelect={onSelect}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Allen Avenue Ikeja/ }));
  expect(onSelect).toHaveBeenCalledWith(prediction);
  expect(screen.getByRole('img', { name: 'Powered by Google' })).toBeVisible();
});
it('shows Geoapify data source credit for a Geoapify batch', () => {
  render(
    <AddressAutocompleteDropdown
      isOpen
      predictions={[{ ...prediction, provider: 'geoapify' }]}
      highlightedIndex={-1}
      dropdownRef={createRef()}
      onSelect={vi.fn()}
    />
  );
  expect(screen.getByRole('link', { name: 'Geoapify' })).toBeVisible();
  expect(screen.getByRole('link', { name: /OpenStreetMap/ })).toBeVisible();
});
it.each([
  false,
  true,
])('renders no suggestions for an empty batch with open=%s', (isOpen) => {
  render(
    <AddressAutocompleteDropdown
      isOpen={isOpen}
      predictions={[]}
      highlightedIndex={-1}
      dropdownRef={createRef()}
      onSelect={vi.fn()}
    />
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
