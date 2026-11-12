// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStaffScreenActions } from './useStaffScreenActions';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  share: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
  Share: { share: mocks.share },
}));

const createMockProps = (
  overrides: Partial<Parameters<typeof useStaffScreenActions>[0]> = {}
): Parameters<typeof useStaffScreenActions>[0] => ({
  autoCreateAccount: true,
  inviteEmail: 'ada@example.com',
  inviteName: 'Ada',
  inviteStaff: { mutateAsync: vi.fn() },
  removeStaff: { mutateAsync: vi.fn() },
  resendInvitation: { mutateAsync: vi.fn() },
  setAutoCreateAccount: vi.fn(),
  setInviteEmail: vi.fn(),
  setInviteModalVisible: vi.fn(),
  setInviteName: vi.fn(),
  setRoleModalVisible: vi.fn(),
  setSelectedRole: vi.fn(),
  setSelectedStaff: vi.fn(),
  updateStaff: { mutateAsync: vi.fn() },
  ...overrides,
});

describe('useStaffScreenActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks invite submission when email is empty', async () => {
    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          inviteEmail: '',
          inviteName: '',
        })
      )
    );

    await act(async () => {
      await result.current.handleInvite();
    });

    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Please enter an email address'
    );
  });

  it('blocks invite submission when the email format is invalid', async () => {
    const inviteStaff = vi.fn();
    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          inviteEmail: 'not-an-email',
          inviteStaff: { mutateAsync: inviteStaff },
        })
      )
    );

    await act(async () => {
      await result.current.handleInvite();
    });

    expect(inviteStaff).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Please enter a valid email address'
    );
  });

  it('resets invite form state and exposes share action on success', async () => {
    const inviteStaff = vi.fn().mockResolvedValue({
      emailDelivery: { status: 'sent' },
      inviteUrl: 'https://usebaci.com/invite',
    });
    const setAutoCreateAccount = vi.fn();
    const setInviteEmail = vi.fn();
    const setInviteModalVisible = vi.fn();
    const setInviteName = vi.fn();

    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          inviteStaff: { mutateAsync: inviteStaff },
          setAutoCreateAccount,
          setInviteEmail,
          setInviteModalVisible,
          setInviteName,
        })
      )
    );

    await act(async () => {
      await result.current.handleInvite();
    });

    expect(inviteStaff).toHaveBeenCalledWith({
      autoCreateAccount: true,
      email: 'ada@example.com',
      name: 'Ada',
      role: 'sales_rep',
    });
    expect(setInviteModalVisible).toHaveBeenCalledWith(false);
    expect(setInviteEmail).toHaveBeenCalledWith('');
    expect(setInviteName).toHaveBeenCalledWith('');
    expect(setAutoCreateAccount).toHaveBeenCalledWith(true);
    expect(mocks.alert.mock.calls[0]?.[0]).toBe('Invitation Sent');
    expect(mocks.alert.mock.calls.length).toBeGreaterThan(0);
    expect(Array.isArray(mocks.alert.mock.calls[0]?.[2])).toBe(true);
    expect(mocks.alert.mock.calls[0]?.[2]?.length).toBeGreaterThan(1);

    const shareAction = mocks.alert.mock.calls[0]?.[2]?.[1];
    expect(shareAction).toBeDefined();
    await act(async () => {
      await shareAction.onPress?.();
    });

    expect(mocks.share).toHaveBeenCalledWith({
      message:
        "You've been invited to join the team! Accept here: https://usebaci.com/invite",
      url: 'https://usebaci.com/invite',
    });
  });

  it('shows an alert when the share sheet cannot be opened', async () => {
    const inviteStaff = vi.fn().mockResolvedValue({
      emailDelivery: { status: 'failed' },
      inviteUrl: 'https://usebaci.com/invite',
    });
    mocks.share.mockRejectedValueOnce(new Error('Share unavailable'));

    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          inviteStaff: { mutateAsync: inviteStaff },
        })
      )
    );

    await act(async () => {
      await result.current.handleInvite();
    });

    const shareAction = mocks.alert.mock.calls[0]?.[2]?.[1];

    await act(async () => {
      await shareAction.onPress?.();
    });

    expect(mocks.alert).toHaveBeenLastCalledWith(
      'Unable to Share',
      'Could not open the share sheet. Please try again.'
    );
  });

  it('keeps unknown users readable in the staff action sheet', () => {
    const { result } = renderHook(() =>
      useStaffScreenActions(createMockProps())
    );

    act(() => {
      result.current.showStaffActions({
        accepted_at: null,
        created_at: '2026-04-13T10:00:00.000Z',
        email: '',
        id: 'staff-unknown',
        invited_at: '2026-04-13T10:00:00.000Z',
        merchant_id: 'merchant-1',
        name: '',
        role: 'sales_rep',
        status: 'pending',
        user_id: null,
      });
    });

    expect(mocks.alert).toHaveBeenCalledWith(
      'Unknown User',
      undefined,
      expect.any(Array)
    );
  });

  it('opens the role sheet when the change-role action is selected', () => {
    const setRoleModalVisible = vi.fn();
    const setSelectedRole = vi.fn();
    const setSelectedStaff = vi.fn();
    const member = {
      id: 'staff-1',
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'manager' as const,
      status: 'active' as const,
      created_at: '2026-04-13T10:00:00.000Z',
      invited_at: '2026-04-13T10:00:00.000Z',
      accepted_at: '2026-04-13T11:00:00.000Z',
    };

    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          setRoleModalVisible,
          setSelectedRole,
          setSelectedStaff,
        })
      )
    );

    act(() => {
      result.current.showStaffActions(member);
    });

    const changeRoleAction = mocks.alert.mock.calls[0][2].find(
      (action: { text: string; onPress?: () => void }) =>
        action.text === 'Change Role'
    );
    expect(changeRoleAction).toBeDefined();
    changeRoleAction.onPress?.();

    expect(setSelectedStaff).toHaveBeenCalledWith(member);
    expect(setSelectedRole).toHaveBeenCalledWith('manager');
    expect(setRoleModalVisible).toHaveBeenCalledWith(true);
  });

  it('updates a role and closes the role sheet on success', async () => {
    const updateStaff = vi.fn().mockResolvedValue(undefined);
    const setRoleModalVisible = vi.fn();
    const setSelectedStaff = vi.fn();

    const { result } = renderHook(() =>
      useStaffScreenActions(
        createMockProps({
          setRoleModalVisible,
          setSelectedStaff,
          updateStaff: { mutateAsync: updateStaff },
        })
      )
    );

    await act(async () => {
      await result.current.handleChangeRole('staff-1', 'manager');
    });

    expect(updateStaff).toHaveBeenCalledWith({
      id: 'staff-1',
      role: 'manager',
    });
    expect(mocks.alert).toHaveBeenCalledWith(
      'Success',
      'Role updated successfully'
    );
    expect(setRoleModalVisible).toHaveBeenCalledWith(false);
    expect(setSelectedStaff).toHaveBeenCalledWith(null);
  });
});
