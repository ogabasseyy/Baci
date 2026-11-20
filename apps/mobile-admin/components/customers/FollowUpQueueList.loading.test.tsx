import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultProps,
  mocks,
  resetFollowUpQueueMocks,
} from '@/test/fixtures/follow-up-queue-list';
import { FollowUpQueueList } from './FollowUpQueueList';

describe('FollowUpQueueList', () => {
  beforeEach(resetFollowUpQueueMocks);

  it('shows loading before reporting an empty queue while staff records are still being fetched', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isLoading: true });
    render(<FollowUpQueueList {...defaultProps} />);
    expect(screen.getByText('Loading follow-ups…')).toBeVisible();
    expect(screen.queryByText('No issues')).toBeNull();
  });

  it('warns that the retained staff scan was capped and counts the visible work', () => {
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      isLimited: true,
      openOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      data: {},
    });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This queue has reached its limit'
    );
    expect(defaultProps.onFollowUpCountChange).toHaveBeenLastCalledWith(1);
  });

  it('shows a retry instead of an empty-queue confirmation when the staff scan fails', () => {
    mocks.useStaffOrderFollowUps.mockReturnValue({ isError: true });
    render(<FollowUpQueueList {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    ).toBeVisible();
    expect(
      screen.queryByText('No follow-ups need attention right now.')
    ).toBeNull();
    expect(defaultProps.onFollowUpCountChange).toHaveBeenLastCalledWith(0);
  });

  it('shows what is loading when checkout rows appear before staff actions', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isLoading: true });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );
    expect(screen.getByText('Ada')).toBeVisible();
    expect(screen.getByText('Loading team follow-up details…')).toBeVisible();
    expect(screen.queryByText('Claim follow-up')).toBeNull();
    expect(defaultProps.onFollowUpCountChange).toHaveBeenLastCalledWith(0);
  });

  it('keeps details readable and lets staff retry when write access cannot be checked', () => {
    const refetchWriteAccess = vi.fn();
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      canWrite: false,
      isWriteAccessError: true,
      refetch: vi.fn(),
      refetchWriteAccess,
    });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.getByText('View follow-up')).toBeVisible();
    expect(
      screen.getByText("Couldn't check who can edit follow-ups.")
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading follow-ups' })
    );
    expect(refetchWriteAccess).toHaveBeenCalledOnce();
  });
});
