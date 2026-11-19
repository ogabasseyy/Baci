import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenApprovalUnconfirmed } from './OxygenApprovalUnconfirmed';

it('shows visible checking text without a button spinner and preserves the update action', () => {
  const refresh = vi.fn(async () => {});
  const view = render(<OxygenApprovalUnconfirmed busy refresh={refresh} />);
  const checking = screen.getByRole('button', { name: 'Checking status…' });
  expect(checking).toBeDisabled();
  expect(checking).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('Checking status…')).toBeVisible();
  expect(checking.querySelector('svg')).toBeNull();
  view.rerender(<OxygenApprovalUnconfirmed busy={false} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});
