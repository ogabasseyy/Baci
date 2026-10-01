import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ExpenseFormHandlerForm,
  useExpenseFormHandlers,
} from './useExpenseFormHandlers';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  picker: vi.fn(),
  prevent: false,
  preventCallback: null as (() => void) | null,
  dispatch: vi.fn(),
}));

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('expo-router', () => ({
  useNavigation: () => ({ dispatch: mocks.dispatch }),
}));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.picker,
}));
vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    mocks.prevent = prevent;
    mocks.preventCallback = callback;
  },
}));

function makeForm(
  isDirty: boolean,
  groupId: string | null = 'group-1'
): ExpenseFormHandlerForm {
  return {
    isDirty,
    setField: vi.fn(),
    setLocalReceipt: vi.fn(),
    values: { groupId },
  };
}

describe('useExpenseFormHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prevent = false;
    mocks.preventCallback = null;
  });

  it('routes native Back through the dirty-form discard confirmation', () => {
    const onNavigateBack = vi.fn();
    renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form: makeForm(true),
        onNavigateBack,
      })
    );

    expect(mocks.prevent).toBe(true);
    mocks.preventCallback?.();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Your unsaved changes will be lost.',
      expect.any(Array)
    );
  });

  it('clears a newly selected archived group but preserves the original group', async () => {
    const form = makeForm(true);
    const archiveGroupMutation = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation,
        form,
        onNavigateBack: vi.fn(),
        originalGroupId: 'original-group',
      })
    );

    await result.current.archiveGroup('group-1');
    expect(archiveGroupMutation).toHaveBeenCalledWith('group-1');
    expect(form.setField).toHaveBeenCalledWith('groupId', null);

    const originalForm = makeForm(true, 'original-group');
    const { result: originalResult } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation,
        form: originalForm,
        onNavigateBack: vi.fn(),
        originalGroupId: 'original-group',
      })
    );
    await originalResult.current.archiveGroup('original-group');
    expect(originalForm.setField).not.toHaveBeenCalled();
  });

  it('bypasses the dirty guard when navigating back after a successful save', () => {
    const onNavigateBack = vi.fn();
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form: makeForm(true),
        onNavigateBack,
      })
    );

    result.current.navigateBackAfterSave();

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
    mocks.preventCallback?.();
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts when the native image picker fails', async () => {
    mocks.picker.mockRejectedValueOnce(new Error('picker unavailable'));
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form: makeForm(false),
        onNavigateBack: vi.fn(),
      })
    );

    await result.current.pickReceipt();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Receipt unavailable',
      'Could not select a receipt image.'
    );
  });
});
