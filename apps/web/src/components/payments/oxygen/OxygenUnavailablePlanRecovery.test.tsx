import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenUnavailablePlanRecovery } from './OxygenUnavailablePlanRecovery';

it('requires confirmation before cancellation and lets the customer keep the plan', () => {
  const cancel = vi.fn().mockResolvedValue(true);
  render(<OxygenUnavailablePlanRecovery busy={false} cancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose another plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep this plan' }));
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose another plan' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel plan and continue' })
  );
  expect(cancel).toHaveBeenCalledOnce();
});
