// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStoreSettingsFormDirty } from './useStoreSettingsFormDirty';

describe('useStoreSettingsFormDirty', () => {
  it('marks local edits dirty until a completed save resets them', () => {
    const { result } = renderHook(() => useStoreSettingsFormDirty());

    act(() => result.current.markFormDirty());
    expect(result.current.isFormDirty).toBe(true);
    expect(result.current.getFormRevision()).toBe(1);

    act(() => result.current.resetFormDirty());
    expect(result.current.isFormDirty).toBe(false);
    expect(result.current.getFormRevision()).toBe(1);
  });
});
