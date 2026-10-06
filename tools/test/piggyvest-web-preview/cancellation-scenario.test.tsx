import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CancellationScenario } from './cancellation-scenario';

const forbidden = vi.fn(() => {
  throw new Error('External side effect prohibited');
});
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal('fetch', forbidden);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(forbidden);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(forbidden);
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function confirm() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare cancellation' }));
}

it('labels actual review amounts and simulated success without real reservation', async () => {
  render(<CancellationScenario />);
  expect(screen.getByText(/No actual reservation, refund/)).toBeVisible();
  expect(screen.getByText('Principal: NGN 100.00')).toBeVisible();
  expect(screen.getByText('Paid interest: NGN 7.00')).toBeVisible();
  expect(screen.getByText('Pending interest: NGN 3.00')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Prepare cancellation' })
  ).toBeDisabled();
  confirm();
  await screen.findByText(/Prepared only\. Not refunded\./);
  expect(
    screen.getByRole('button', { name: 'Prepare cancellation' })
  ).toBeDisabled();
});

it('renders uncertainty without enabling another submit', async () => {
  render(<CancellationScenario />);
  change('Cancellation result', 'uncertain');
  confirm();
  await screen.findByText(/Reservation may be retained/);
  expect(screen.queryByText(/Prepared only/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Prepare cancellation' })
  ).toBeDisabled();
});

it('clears consent for availability, goal and session switches', () => {
  render(<CancellationScenario />);
  for (const [label, value, restore] of [
    ['Cancellation quote', 'unavailable', 'available'],
    ['Cancellation goal', 'b', 'a'],
    ['Cancellation session', 'none', 'a'],
    ['Cancellation session', 'b', 'a'],
  ]) {
    fireEvent.click(screen.getByRole('checkbox'));
    change(label, value);
    expect(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    ).toBeDisabled();
    change(label, restore);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  }
});
