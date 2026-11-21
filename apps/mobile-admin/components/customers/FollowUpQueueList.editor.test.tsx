import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultProps,
  mocks,
  resetFollowUpQueueMocks,
} from '@/test/fixtures/follow-up-queue-list';
import { FollowUpQueueList } from './FollowUpQueueList';

describe('FollowUpQueueList', () => {
  beforeEach(resetFollowUpQueueMocks);

  it('offers view-only staff a details action for unassigned work', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      canWrite: false,
    });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    expect(screen.queryByText('Claim follow-up')).toBeNull();
    fireEvent.click(screen.getByText('View follow-up'));
    expect(screen.getByText('Open follow-up editor')).toBeVisible();
  });

  it('updates the action when write access changes and follow-up rows stay the same', () => {
    const records = {};
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      canWrite: false,
      data: records,
    });
    const props = { ...defaultProps, renderOrder: () => <div>Ada</div> };
    const { rerender } = render(<FollowUpQueueList {...props} />);
    expect(screen.getByText('View follow-up')).toBeVisible();
    expect(mocks.flashListExtraData).toHaveBeenLastCalledWith({
      records,
      canWrite: false,
      viewerId: 'viewer',
      isSuccess: true,
    });

    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      canWrite: true,
      data: records,
    });
    rerender(<FollowUpQueueList {...props} />);

    expect(screen.getByText('Claim follow-up')).toBeVisible();
    expect(screen.queryByText('View follow-up')).toBeNull();
    expect(mocks.flashListExtraData).toHaveBeenLastCalledWith({
      records,
      canWrite: true,
      viewerId: 'viewer',
      isSuccess: true,
    });
  });

  it('preserves a claim conflict when refreshing changes the editor revision', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isSuccess: true });
    const props = { ...defaultProps, renderOrder: () => <div>Ada</div> };
    const { rerender } = render(<FollowUpQueueList {...props} />);
    fireEvent.click(screen.getByText('Claim follow-up'));
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      data: {
        'order-1': { stage: 'waiting', assignee_id: 'teammate', revision: 1 },
      },
      saveError: 'Someone else has already claimed this follow-up.',
    });
    rerender(<FollowUpQueueList {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Someone else has already claimed this follow-up.'
    );
  });

  it('keeps an open editor mounted when its retained order leaves the active queue', () => {
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'empty' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      data: {
        'order-1': { stage: 'waiting', assignee_id: 'viewer', revision: 1 },
      },
    });
    const props = { ...defaultProps, renderOrder: () => <div>Ada</div> };
    const { rerender } = render(<FollowUpQueueList {...props} />);
    fireEvent.click(screen.getByText('Update follow-up'));
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      openOrders: [],
      data: {},
      saveError:
        'This follow-up changed. Check the latest details before saving.',
    });
    rerender(<FollowUpQueueList {...props} />);
    expect(screen.getByText('Open follow-up editor')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This follow-up changed.'
    );
    expect(
      screen.getByRole('button', { name: 'Claim from editor' })
    ).toBeDisabled();
  });

  it('tells the editor a claim just succeeded and clears that when the editor closes', async () => {
    const save = vi.fn().mockResolvedValue({ order_id: 'order-1' });
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [
        {
          id: 'order-1',
          created_at: '2026-07-27T08:00:00Z',
          customer_name: 'Ada',
        },
      ],
      merchant: { id: 'merchant-1' },
      refresh: mocks.refresh,
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({
      isSuccess: true,
      data: {},
      save,
    });

    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    fireEvent.click(screen.getByText('Claim follow-up'));
    expect(screen.queryByText('Claim confirmed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Claim from editor' }));
    expect(await screen.findByText('Claim confirmed')).toBeVisible();
    expect(save).toHaveBeenCalledWith({ type: 'claim', orderId: 'order-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByText('Claim follow-up'));
    expect(screen.queryByText('Claim confirmed')).toBeNull();
  });

  it('keeps a late claim confirmation out of a newly opened editor', async () => {
    let finishClaim: (value: { order_id: string }) => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<{ order_id: string }>((resolve) => {
          finishClaim = resolve;
        })
    );
    mocks.useFollowUpQueue.mockReturnValue({
      failedOrders: [{ id: 'order-1', created_at: '2026-07-27T08:00:00Z' }],
      merchant: { id: 'merchant-1' },
      viewState: { status: 'ready' },
    });
    mocks.useStaffOrderFollowUps.mockReturnValue({ isSuccess: true, save });
    render(
      <FollowUpQueueList {...defaultProps} renderOrder={() => <div>Ada</div>} />
    );

    fireEvent.click(screen.getByText('Claim follow-up'));
    fireEvent.click(screen.getByRole('button', { name: 'Claim from editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByText('Claim follow-up'));
    await act(async () => finishClaim({ order_id: 'order-1' }));

    expect(screen.queryByText('Claim confirmed')).toBeNull();
  });
});
