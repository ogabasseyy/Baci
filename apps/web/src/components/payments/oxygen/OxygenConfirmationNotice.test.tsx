import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenConfirmationNotice } from './OxygenConfirmationNotice';

it('identifies an uncertain NIN check without claiming verification is still running', () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenConfirmationNotice
      booking={false}
      identityCheck
      busy={false}
      refresh={refresh}
    />
  );
  expect(
    screen.getByRole('heading', {
      name: 'Your NIN verification needs confirmation',
    })
  ).toBeVisible();
  expect(screen.getByText(/Your code was accepted/)).toBeVisible();
  expect(screen.queryByText('Taking a little longer')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('retains payment plan confirmation for an uncertain booking', () => {
  render(<OxygenConfirmationNotice booking busy={false} refresh={vi.fn()} />);
  expect(
    screen.getByRole('heading', {
      name: 'Your payment plan is being confirmed',
    })
  ).toBeVisible();
});
