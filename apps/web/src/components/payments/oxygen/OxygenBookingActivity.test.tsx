import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenPlanForm } from './OxygenPlanForm';

it('shows the full booking activity immediately, sends the selected plan once, and retains the choice on failure', async () => {
  let finish!: (value: boolean) => void;
  const submit = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
  );
  render(
    <OxygenPlanForm busy={false} submit={submit} productAmount={198000} />
  );
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '35%' }));
  const form = screen.getByRole('form', { name: 'Choose payment plan' });
  fireEvent.submit(form);
  expect(
    screen.getByRole('heading', { name: 'Booking your selected payment plan' })
  ).toBeVisible();
  expect(
    screen.queryByRole('form', { name: 'Choose payment plan' })
  ).toBeNull();
  expect(submit).toHaveBeenCalledWith({
    action: 'book',
    equityPercentage: 35,
    tenure: 3,
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => finish(false));
  await waitFor(() =>
    expect(
      screen.getByRole('form', { name: 'Choose payment plan' })
    ).toBeVisible()
  );
  expect(screen.getByRole('button', { name: '35%' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(submit).toHaveBeenCalledTimes(1);
});
