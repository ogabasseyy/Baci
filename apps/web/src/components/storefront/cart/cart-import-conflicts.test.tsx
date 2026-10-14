import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CartImportConflicts } from './cart-import-conflicts';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  enabled: true,
  conflicts: [
    { item: { productId: 'phone' } },
    { item: { productId: 'charger' } },
  ],
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    sharedCartEnabled: mocks.enabled,
    importConflicts: mocks.conflicts,
    resolveImportConflicts: mocks.resolve,
  }),
}));
beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.enabled = true;
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
