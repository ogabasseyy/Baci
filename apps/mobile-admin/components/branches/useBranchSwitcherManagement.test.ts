// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from '@/schemas/branch';
import { useBranchSwitcherManagement } from './useBranchSwitcherManagement';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  createBranch: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  deactivateBranch: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  haptics: {
    impactAsync: vi.fn(),
    notificationAsync: vi.fn(),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
    NotificationFeedbackType: { Success: 'success' },
  },
  updateBranch: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}));

vi.mock('expo-haptics', () => mocks.haptics);

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: mocks.alert },
}));

vi.mock('@/hooks/useBranches', () => ({
  useCreateBranch: () => mocks.createBranch,
  useDeactivateBranch: () => mocks.deactivateBranch,
  useUpdateBranch: () => mocks.updateBranch,
}));

const branches: Branch[] = [
  {
    active: true,
    address: null,
    city: 'Lagos',
    created_at: '2026-05-01T00:00:00+00:00',
    id: 'branch-1',
    is_default: true,
    manager_id: null,
    merchant_id: 'merchant-1',
    name: 'Lagos main',
    phone: null,
    state: null,
    updated_at: '2026-05-01T00:00:00+00:00',
  },
  {
    active: true,
    address: null,
    city: 'Abuja',
    created_at: '2026-05-01T00:00:00+00:00',
    id: 'branch-2',
    is_default: false,
    manager_id: null,
    merchant_id: 'merchant-1',
    name: 'Abuja',
    phone: null,
    state: null,
    updated_at: '2026-05-01T00:00:00+00:00',
  },
];

function renderManagement({
  branchId = null,
  branchRows = branches,
  setAllLocations = vi.fn(),
}: {
  branchId?: string | null;
  branchRows?: Branch[];
  setAllLocations?: () => void;
} = {}) {
  const result = renderHook(() =>
    useBranchSwitcherManagement({
      branchId,
      branches: branchRows,
      setAllLocations,
    })
  );

  return { ...result, setAllLocations };
}

describe('useBranchSwitcherManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBranch.isPending = false;
    mocks.updateBranch.isPending = false;
    mocks.deactivateBranch.isPending = false;
    mocks.createBranch.mutateAsync.mockResolvedValue(undefined);
    mocks.updateBranch.mutateAsync.mockResolvedValue(undefined);
    mocks.deactivateBranch.mutateAsync.mockResolvedValue(undefined);
  });

  it('maps create and update schema name failures to field errors', async () => {
    const { result } = renderManagement();

    await act(async () => {
      await result.current.handleCreateBranch();
    });
    expect(result.current.nameError).toMatch(
      /^(Too small: expected string to have >=2 characters|String must contain at least 2 character\(s\))$/
    );
    expect(mocks.createBranch.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      result.current.handleManageBranchPress(branches[0]);
      result.current.setEditName('');
    });
    await act(async () => {
      await result.current.handleUpdateBranch();
    });

    expect(result.current.editNameError).toMatch(
      /^(Too small: expected string to have >=2 characters|String must contain at least 2 character\(s\))$/
    );
    expect(mocks.updateBranch.mutateAsync).not.toHaveBeenCalled();
  });

  it('short-circuits mutation handlers while matching mutations are pending', async () => {
    mocks.createBranch.isPending = true;
    mocks.updateBranch.isPending = true;
    mocks.deactivateBranch.isPending = true;
    const { result } = renderManagement();

    act(() => {
      result.current.setBranchName('Lekki');
      result.current.handleManageBranchPress(branches[0]);
    });
    await act(async () => {
      await result.current.handleCreateBranch();
      await result.current.handleUpdateBranch();
      await result.current.handleDeactivateBranch();
    });

    expect(mocks.createBranch.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.updateBranch.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.deactivateBranch.mutateAsync).not.toHaveBeenCalled();
  });

  it('closes create and update modal state after successful mutations', async () => {
    const { result } = renderManagement();

    act(() => {
      result.current.handleCreatePress();
      result.current.setBranchName('Lekki');
    });
    await act(async () => {
      await result.current.handleCreateBranch();
    });

    expect(mocks.createBranch.mutateAsync).toHaveBeenCalledWith({
      name: 'Lekki',
      address: undefined,
      isDefault: false,
    });
    expect(result.current.isModalVisible).toBe(false);

    act(() => {
      result.current.handleManageBranchPress(branches[0]);
      result.current.setEditName('Lagos HQ');
    });
    await act(async () => {
      await result.current.handleUpdateBranch();
    });

    expect(mocks.updateBranch.mutateAsync).toHaveBeenCalledWith({
      branchId: 'branch-1',
      input: { name: 'Lagos HQ', address: null },
    });
    expect(result.current.editingBranch).toBeNull();
    expect(mocks.haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('blocks deactivation when only one active branch exists', async () => {
    const { result } = renderManagement({ branchRows: [branches[0]] });

    act(() => {
      result.current.handleManageBranchPress(branches[0]);
    });
    await act(async () => {
      await result.current.handleDeactivateBranch();
    });

    expect(result.current.canDeactivateEditingBranch).toBe(false);
    expect(mocks.deactivateBranch.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Required',
      'Create another branch before deactivating this one.'
    );
  });

  it('resets all locations when deactivating the selected branch', async () => {
    const setAllLocations = vi.fn();
    const { result } = renderManagement({
      branchId: 'branch-1',
      setAllLocations,
    });

    act(() => {
      result.current.handleManageBranchPress(branches[0]);
    });
    await act(async () => {
      await result.current.handleDeactivateBranch();
    });

    expect(mocks.deactivateBranch.mutateAsync).toHaveBeenCalledWith('branch-1');
    expect(setAllLocations).toHaveBeenCalledTimes(1);
    expect(result.current.editingBranch).toBeNull();
  });
});
