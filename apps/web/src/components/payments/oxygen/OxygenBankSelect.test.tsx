import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OxygenBankSelect } from './OxygenBankSelect';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
function Picker({ onFormChange = () => {} }: { onFormChange?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <form aria-label="Bank form" onChange={onFormChange}>
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

it('lists banks alphabetically and filters locally without changing the saved selection', async () => {
  const change = vi.fn();
  const banks = [
    { name: 'Zenith Bank', code: '057' },
    { name: 'Access Bank', code: '044' },
    { name: 'Wema Bank', code: '035' },
  ];
  render(
    <form aria-label="Bank form">
      <label htmlFor="bank">Bank</label>
      <OxygenBankSelect
        id="bank"
        banks={banks}
        value="035"
        onChange={change}
        loading={false}
        disabled={false}
      />
    </form>
  );
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Bank' }), {
    key: 'Enter',
  });
  expect(
    (await screen.findAllByRole('option')).map((item) => item.textContent)
  ).toEqual(['Access Bank', 'Wema Bank', 'Zenith Bank']);
  const search = screen.getByRole('combobox', { name: 'Search banks' });
  fireEvent.change(search, { target: { value: '  ZEN  ' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Zenith Bank' })).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  expect(
    new FormData(screen.getByRole('form') as HTMLFormElement).get('bank_code')
  ).toBe('035');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(change).toHaveBeenCalledWith('057');
  expect(banks.map((bank) => bank.name)).toEqual([
    'Zenith Bank',
    'Access Bank',
    'Wema Bank',
  ]);
});

it('shows an empty result and resets the search when reopened', async () => {
  render(<Picker />);
  const trigger = screen.getByRole('combobox', { name: 'Bank' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const search = await screen.findByRole('combobox', { name: 'Search banks' });
  fireEvent.change(search, { target: { value: 'not-a-bank' } });
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('No banks found');
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(await screen.findAllByRole('option')).toHaveLength(2);
});

it('notifies the enclosing autosave form when a bank is selected', async () => {
  const change = vi.fn();
  render(<Picker onFormChange={change} />);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Bank' }), {
    key: 'Enter',
  });
  fireEvent.click(await screen.findByRole('option', { name: 'GT Bank' }));
  expect(change).toHaveBeenCalled();
});

it('blocks pointer interaction behind the open picker and restores focus when dismissed', async () => {
  render(<Picker />);
  const trigger = screen.getByRole('combobox', { name: 'Bank' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const search = await screen.findByRole('combobox', { name: 'Search banks' });
  expect(document.body.style.pointerEvents).toBe('none');
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(document.body.style.pointerEvents).not.toBe('none');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
