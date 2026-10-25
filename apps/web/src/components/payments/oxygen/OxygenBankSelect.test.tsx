import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OxygenBankSelect } from './OxygenBankSelect';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
function Picker() {
  const [value, setValue] = useState('');
  return (
    <form aria-label="Bank form">
      <label htmlFor="bank">Bank</label>
      <OxygenBankSelect
        id="bank"
        banks={[
          { name: 'GT Bank', code: '058' },
          { name: 'New bank', code: '987654' },
        ]}
        value={value}
        onChange={setValue}
        loading={false}
        disabled={false}
      />
    </form>
  );
}
it('shows bank logos in choices and selected value while submitting the exact provider code', async () => {
  render(<Picker />);
  const trigger = screen.getByRole('combobox', { name: 'Bank' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const option = await screen.findByRole('option', { name: 'GT Bank' });
  expect(option.querySelector('img')).not.toBeNull();
  expect(
    screen.getByRole('option', { name: 'New bank' }).querySelector('svg')
  ).not.toBeNull();
  fireEvent.click(option);
  expect(trigger).toHaveTextContent('GT Bank');
  expect(trigger.querySelector('img')).not.toBeNull();
  expect(
    new FormData(screen.getByRole('form') as HTMLFormElement).get('bank_code')
  ).toBe('058');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(within(trigger).queryByRole('img')).toBeNull(); // decorative, bank name remains accessible
});
it('disables selection during loading', () => {
  render(
    <OxygenBankSelect
      id="bank"
      banks={[]}
      value=""
      onChange={vi.fn()}
      loading
      disabled
    />
  );
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('combobox')).toHaveTextContent('Loading banks');
});
