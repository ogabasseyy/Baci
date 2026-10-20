import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CartImportConflicts } from './cart-import-conflicts';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  discard: vi.fn(),
  enabled: true,
  warnings: [] as string[],
  conflicts: [
    { item: { productId: 'phone' } },
    { item: { productId: 'charger' } },
  ],
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    sharedCartEnabled: mocks.enabled,
    importConflicts: mocks.conflicts,
    importWarnings: mocks.warnings,
    resolveImportConflicts: mocks.resolve,
    discardLegacyImport: mocks.discard,
  }),
}));
beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.discard.mockReset();
  mocks.enabled = true;
  mocks.warnings = [];
});
it('requires an explicit offer for every conflicting item and replaces a changed choice', () => {
  render(<CartImportConflicts />);
  const combine = screen.getByRole('button', {
    name: 'Combine with my choices',
  });
  expect(combine).toBeDisabled();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Keep shared cart offer' })[0]
  );
  expect(combine).toBeDisabled();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Keep device cart offer' })[0]
  );
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Keep shared cart offer' })[1]
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
  fireEvent.click(combine);
  expect(mocks.resolve).toHaveBeenCalledWith([
    { item: { productId: 'phone' }, keep: 'incoming' },
    { item: { productId: 'charger' }, keep: 'existing' },
  ]);
});
it('does not offer to import when shared carts are disabled', () => {
  mocks.enabled = false;
  render(<CartImportConflicts />);
  expect(
    screen.queryByRole('region', { name: 'Cart import choices' })
  ).toBeNull();
});

it('shows capacity recovery even without offer conflicts and explicitly retries the retained device cart', () => {
  mocks.warnings = ['import_capacity_exceeded'];
  render(<CartImportConflicts />);
  expect(
    screen.getByRole('region', { name: 'Cart import capacity' })
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Your device items and offers are still saved on this device'
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Remove items below or from your shared cart'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry importing device cart' })
  );
  expect(mocks.resolve).toHaveBeenCalledWith([]);
});

it('offers an explicit discard choice when making room cannot fit the retained device cart', () => {
  mocks.warnings = ['import_capacity_exceeded'];
  render(<CartImportConflicts />);
  expect(mocks.discard).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Keep shared cart and discard saved device cart',
    })
  );
  expect(mocks.discard).toHaveBeenCalledOnce();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
