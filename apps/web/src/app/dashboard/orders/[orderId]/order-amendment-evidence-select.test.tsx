import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderAmendmentEvidenceSelect } from './order-amendment-evidence-select';

const id = '42778a83-0ed7-4fa5-9e1d-4ea7a085b217';

it('names the verified tender and reports the selected evidence ID', () => {
  const onChange = vi.fn();
  render(
    <OrderAmendmentEvidenceSelect
      entries={[
        {
          id,
          method: 'pos',
          amountMinor: 2_000_000,
          occurredAt: '2026-11-22T16:00:00Z',
        },
      ]}
      value=""
      onChange={onChange}
      money={(minor) => `₦${minor / 100}`}
    />
  );
  expect(screen.getByRole('option', { name: /POS · ₦20000/ })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Verified top-up' }), {
    target: { value: id },
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(id);
});

it('explains when the order has no matching verified payment', () => {
  render(
    <OrderAmendmentEvidenceSelect
      entries={[]}
      value=""
      onChange={vi.fn()}
      money={String}
    />
  );
  expect(
    screen.getByRole('option', { name: 'No matching payment verified' })
  ).toBeVisible();
});

it('directs staff to mobile for an eligible Cash or POS top-up', () => {
  render(
    <OrderAmendmentEvidenceSelect
      entries={[]}
      value=""
      onChange={vi.fn()}
      money={String}
      canRecordStaffTopUp
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Use Change items in the mobile admin app to record Cash or POS.'
  );
  expect(screen.queryByRole('combobox')).toBeNull();
});
