// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from '@/components/staff/types';
import { useBranchManagement } from '@/hooks/useBranchManagement';

const alertMock = vi.hoisted(() => vi.fn());
const branchScopeMocks = vi.hoisted(() => ({
  scope: { type: 'all' } as
    | { type: 'all' }
    | { type: 'branch'; branchId: string },
  setAllLocations: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: {
    alert: alertMock,
  },
}));

vi.mock('@/hooks/useBranchScope', () => ({
  useBranchScope: () => ({
    scope: branchScopeMocks.scope,
    setAllLocations: branchScopeMocks.setAllLocations,
  }),
}));

const branches: Branch[] = [
  {
    id: 'branch-1',
    name: 'Lagos main',
    address: null,
    city: 'Lagos',
    is_default: true,
    active: true,
  },
  {
    id: 'branch-2',
    name: 'Abuja',
    address: null,
    city: 'Abuja',
    is_default: false,
    active: true,
  },
];

function renderBranchManagement({
  createPending = false,
  deactivatePending = false,
  updatePending = false,
  branchRows = branches,
} = {}) {
  const createMutate = vi.fn();
  const updateMutate = vi.fn();
  const deactivateMutate = vi.fn();

  const result = renderHook(() =>
    useBranchManagement({
      branches: branchRows,
      createBranchMutation: {
        isPending: createPending,
        mutate: createMutate,
      },
      updateBranchMutation: {
        isPending: updatePending,
        mutate: updateMutate,
      },
      deactivateBranchMutation: {
        isPending: deactivatePending,
        mutate: deactivateMutate,
      },
    })
  );

  return {
    ...result,
    createMutate,
    deactivateMutate,
    updateMutate,
  };
}

describe('useBranchManagement', () => {
  beforeEach(() => {
    alertMock.mockReset();
    branchScopeMocks.scope = { type: 'all' };
    branchScopeMocks.setAllLocations.mockReset();
  });

  it('does not submit duplicate create mutations while create is pending', () => {
    const { createMutate, result } = renderBranchManagement({
      createPending: true,
    });

    act(() => {
      result.current.setNewBranchName('Lekki');
    });
    act(() => {
      result.current.handleBranchSubmit();
    });

    expect(createMutate).not.toHaveBeenCalled();
    expect(result.current.isBranchMutationPending).toBe(true);
  });

  it('does not submit duplicate update mutations while update is pending', () => {
    const { result, updateMutate } = renderBranchManagement({
      updatePending: true,
    });

    act(() => {
      result.current.openEditBranchModal('branch-1');
    });
    act(() => {
      result.current.handleBranchSubmit();
    });

    expect(updateMutate).not.toHaveBeenCalled();
    expect(result.current.isBranchMutationPending).toBe(true);
  });

  it('preserves an explicitly cleared city when editing a branch', () => {
    const { result, updateMutate } = renderBranchManagement();

    act(() => {
      result.current.openEditBranchModal('branch-1');
    });
    act(() => {
      result.current.setNewBranchCity('');
    });
    act(() => {
      result.current.handleBranchSubmit();
    });

    expect(updateMutate).toHaveBeenCalledWith(
      {
        branchId: 'branch-1',
        input: {
          name: 'Lagos main',
          city: null,
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      })
    );
  });

  it('guards deactivation inside the confirmation action', () => {
    const { deactivateMutate, result } = renderBranchManagement({
      branchRows: [branches[0]],
    });

    act(() => {
      result.current.handleDeactivateBranch('branch-1');
    });

    expect(alertMock).toHaveBeenCalledTimes(1);
    const actions = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const deactivateAction = actions.find(
      (action) => action.text === 'Deactivate'
    );
    expect(deactivateAction).toBeDefined();
    act(() => {
      deactivateAction?.onPress?.();
    });

    expect(deactivateMutate).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(2);
    expect(alertMock).toHaveBeenCalledWith(
      'Branch required',
      'At least one active branch is required.'
    );
  });

  it('does not submit duplicate deactivate mutations while deactivate is pending', () => {
    const { deactivateMutate, result } = renderBranchManagement({
      deactivatePending: true,
    });

    act(() => {
      result.current.handleDeactivateBranch('branch-1');
    });

    expect(alertMock).toHaveBeenCalledTimes(1);
    const actions = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const deactivateAction = actions.find(
      (action) => action.text === 'Deactivate'
    );
    expect(deactivateAction).toBeDefined();
    act(() => {
      deactivateAction?.onPress?.();
    });

    expect(deactivateMutate).not.toHaveBeenCalled();
  });

  it('resets branch scope when the deactivated branch is currently selected', () => {
    branchScopeMocks.scope = { type: 'branch', branchId: 'branch-1' };
    const { deactivateMutate, result } = renderBranchManagement();

    act(() => {
      result.current.handleDeactivateBranch('branch-1');
    });
    const actions = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const deactivateAction = actions.find(
      (action) => action.text === 'Deactivate'
    );

    act(() => {
      deactivateAction?.onPress?.();
    });
    expect(deactivateMutate).toHaveBeenCalledTimes(1);
    const callbacks = deactivateMutate.mock.calls[0][1] as {
      onSuccess?: () => void;
    };

    act(() => {
      callbacks.onSuccess?.();
    });

    expect(branchScopeMocks.setAllLocations).toHaveBeenCalledTimes(1);
    expect(result.current.showBranchModal).toBe(false);
    expect(result.current.editingBranchId).toBeNull();
  });

  it('keeps branch scope when deactivating a different branch', () => {
    branchScopeMocks.scope = { type: 'branch', branchId: 'branch-2' };
    const { deactivateMutate, result } = renderBranchManagement();

    act(() => {
      result.current.handleDeactivateBranch('branch-1');
    });
    const actions = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const deactivateAction = actions.find(
      (action) => action.text === 'Deactivate'
    );

    act(() => {
      deactivateAction?.onPress?.();
    });
    expect(deactivateMutate).toHaveBeenCalledTimes(1);
    const callbacks = deactivateMutate.mock.calls[0][1] as {
      onSuccess?: () => void;
    };

    act(() => {
      callbacks.onSuccess?.();
    });

    expect(branchScopeMocks.setAllLocations).not.toHaveBeenCalled();
  });

  it('shows an alert when branch creation fails', () => {
    const { createMutate, result } = renderBranchManagement();

    act(() => {
      result.current.setNewBranchName('Lekki');
    });
    act(() => {
      result.current.handleBranchSubmit();
    });

    const callbacks = createMutate.mock.calls[0][1] as { onError?: () => void };
    act(() => {
      callbacks.onError?.();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Create failed',
      'Could not create this branch.'
    );
  });

  it('shows an alert when branch update fails', () => {
    const { result, updateMutate } = renderBranchManagement();

    act(() => {
      result.current.openEditBranchModal('branch-1');
    });
    act(() => {
      result.current.handleBranchSubmit();
    });

    const callbacks = updateMutate.mock.calls[0][1] as { onError?: () => void };
    act(() => {
      callbacks.onError?.();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Update failed',
      'Could not update this branch.'
    );
  });

  it('shows an alert when branch deactivation fails', () => {
    const { deactivateMutate, result } = renderBranchManagement();

    act(() => {
      result.current.handleDeactivateBranch('branch-1');
    });
    const actions = alertMock.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const deactivateAction = actions.find(
      (action) => action.text === 'Deactivate'
    );
    act(() => {
      deactivateAction?.onPress?.();
    });

    const callbacks = deactivateMutate.mock.calls[0][1] as {
      onError?: () => void;
    };
    act(() => {
      callbacks.onError?.();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Deactivate failed',
      'Could not deactivate this branch.'
    );
  });
});
