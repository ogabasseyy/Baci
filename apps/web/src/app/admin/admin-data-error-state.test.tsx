import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminDataErrorState } from './admin-data-error-state';

describe('AdminDataErrorState', () => {
  it('explains the failure and lets the operator retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <AdminDataErrorState
        message="Live analytics could not be loaded."
        onRetry={onRetry}
        retrying={false}
        title="Analytics unavailable"
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Live analytics could not be loaded.'
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables duplicate retries while a request is running', () => {
    render(
      <AdminDataErrorState
        message="Live analytics could not be loaded."
        onRetry={vi.fn()}
        retrying
        title="Analytics unavailable"
      />
    );

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
