import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenSelfieSessionRecovery } from './OxygenSelfieSessionRecovery';

it('shows errors and permits explicit retry, disabling it while renewing', () => {
  const retry = vi.fn();
  const view = render(
    <OxygenSelfieSessionRecovery
      renewing={false}
      error="Unavailable"
      onRetry={retry}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(
    <OxygenSelfieSessionRecovery renewing error="" onRetry={retry} />
  );
  expect(screen.getByRole('heading')).toHaveTextContent('Refreshing');
  expect(screen.getByRole('button')).toBeDisabled();
});
it('does not offer a nonfunctional retry when renewal is unavailable', () => {
  render(<OxygenSelfieSessionRecovery renewing={false} error="" />);
  expect(screen.queryByRole('button')).toBeNull();
});
