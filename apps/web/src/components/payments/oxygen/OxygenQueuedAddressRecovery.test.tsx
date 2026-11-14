import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('./OxygenResidentialForm', () => ({
  OxygenResidentialForm: () => <button type="button">Select proof</button>,
}));

import { OxygenQueuedAddressRecovery } from './OxygenQueuedAddressRecovery';

it('asks the customer to reselect proof before continuing', () => {
  render(
    <OxygenQueuedAddressRecovery
      snapshot={{ workflowId: 'workflow' } as never}
      busy={false}
      error=""
      refresh={vi.fn()}
      submit={vi.fn()}
    />
  );
  expect(screen.getByText(/Select your proof again/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Select proof' })).toBeDefined();
});
it('shows a status check when retirement could not be confirmed', () => {
  const refresh = vi.fn();
  render(
    <OxygenQueuedAddressRecovery
      snapshot={{ workflowId: 'workflow' } as never}
      busy={false}
      error="unconfirmed"
      refresh={refresh}
      submit={vi.fn()}
    />
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'Check your saved status'
  );
  screen.getByRole('button', { name: 'Check saved status' }).click();
  expect(refresh).toHaveBeenCalledOnce();
});
