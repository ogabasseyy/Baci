import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CartHandoffPreviewStatus } from './cart-handoff-preview-status';

it('shows a retry for a failed destination lookup but none for an ended link', () => {
  const retry = vi.fn();
  const { rerender } = render(
    <CartHandoffPreviewStatus
      destinationError="Offline"
      loadError={null}
      previewRetryable={false}
      retry={retry}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(
    <CartHandoffPreviewStatus
      destinationError={null}
      loadError="Ended"
      previewRetryable={false}
      retry={retry}
    />
  );
  expect(screen.getByRole('heading')).toHaveTextContent('This cart link ended');
  expect(screen.queryByRole('button')).toBeNull();
});
