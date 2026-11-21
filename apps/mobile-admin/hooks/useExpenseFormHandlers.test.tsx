import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ExpenseFormHandlerForm,
  useExpenseFormHandlers,
} from './useExpenseFormHandlers';

type PreventRemoveEvent = {
  data: { action: { type: 'GO_BACK' } };
  repeat: () => void;
};

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  picker: vi.fn(),
  prevent: false,
  preventCallback: null as ((event: PreventRemoveEvent) => void) | null,
  router: { back: vi.fn(), canGoBack: () => true },
}));

vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.picker,
}));
vi.mock('expo-router', () => ({
  usePreventRemove: (
    prevent: boolean,
    callback: (event: PreventRemoveEvent) => void
  ) => {
    mocks.prevent = prevent;
    mocks.preventCallback = callback;
    return () => {
      mocks.prevent = false;
    };
  },
  useRouter: () => mocks.router,
}));

function makeForm(
  isDirty: boolean,
  groupId: string | null = 'group-1'
): ExpenseFormHandlerForm {
  return {
    isDirty,
    receiptChange: { kind: 'unchanged' },
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
    const form = makeForm(true);
    renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form,
      })
    );

    expect(mocks.prevent).toBe(true);
    const repeat = vi.fn();
    mocks.preventCallback?.({ data: { action: { type: 'GO_BACK' } }, repeat });
    expect(mocks.alert).toHaveBeenCalledWith(
      'Discard changes?',
      'Your unsaved changes will be lost.',
      expect.any(Array)
    );
    expect(repeat).not.toHaveBeenCalled();
    const actions = mocks.alert.mock.calls[0]?.[2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    act(() => {
      actions.find(({ text }) => text === 'Discard')?.onPress?.();
    });
    expect(repeat).toHaveBeenCalledOnce();
    expect(mocks.prevent).toBe(false);
  });

  it('clears a newly selected archived group but preserves the original group', async () => {
    const form = makeForm(true);
    const archiveGroupMutation = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation,
        form,
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
        originalGroupId: 'original-group',
      })
    );
    await originalResult.current.archiveGroup('original-group');
    expect(originalForm.setField).not.toHaveBeenCalled();
  });

  it('bypasses the dirty guard when navigating back after a successful save', () => {
    const form = makeForm(true);
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form,
      })
    );

    act(() => result.current.navigateBackAfterSave());

    expect(mocks.router.back).toHaveBeenCalledTimes(1);
    expect(mocks.prevent).toBe(false);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('alerts when the native image picker fails', async () => {
    mocks.picker.mockRejectedValueOnce(new Error('picker unavailable'));
    const { result } = renderHook(() =>
      useExpenseFormHandlers({
        archiveGroupMutation: vi.fn(),
        form: makeForm(false),
      })
    );

    await result.current.pickReceipt();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Receipt unavailable',
      'Could not select a receipt image.'
    );
  });
});
