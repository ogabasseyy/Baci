import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { DraftCatalogue } from './draft-catalogue';

it('requires exact variant and passes identifiers only, not displayed price', () => {
  const { record } = savingsDraftFixture();
  const create = vi.fn();
  render(
    <DraftCatalogue
      products={[{ ...record.catalogue, has_variants: true }]}
      busy={false}
      page={{ search: '', page: 0 }}
      onSearch={vi.fn()}
      onCreate={create}
    />
  );
  fireEvent.change(screen.getByLabelText('Device'), {
    target: { value: record.productId },
  });
  expect(
    screen.getByRole('button', { name: 'Review savings draft' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /Storage: 256GB/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review savings draft' }));
  expect(create).toHaveBeenCalledWith({
    productId: record.productId,
    variantId: record.variantId,
  });
});
it('fails closed when declared variants are missing and exposes a catalogue search', () => {
  const { record } = savingsDraftFixture();
  const search = vi.fn();
  render(
    <DraftCatalogue
      products={[{ ...record.catalogue, variants: [], has_variants: true }]}
      busy={false}
      page={{ search: '', page: 0 }}
      onSearch={search}
      onCreate={vi.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText('Device'), {
    target: { value: record.productId },
  });
  expect(
    screen.getByRole('button', { name: 'Review savings draft' })
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Search devices'), {
    target: { value: 'phone' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(search).toHaveBeenCalledWith('phone', 0);
});
