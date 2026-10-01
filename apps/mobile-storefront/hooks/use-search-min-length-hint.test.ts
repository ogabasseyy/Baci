import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSearchMinLengthHint } from './use-search-min-length-hint';

describe('useSearchMinLengthHint', () => {
  it('starts without the hint', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    expect(result.current.showSearchMinLengthHint).toBe(false);
  });

  it('shows the hint for rejected commits and clears it for valid ones', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    let committed: boolean | undefined;
    act(() => {
      committed = result.current.evaluateCommit('!!');
    });
    expect(committed).toBe(false);
    expect(result.current.showSearchMinLengthHint).toBe(true);

    act(() => {
      committed = result.current.evaluateCommit('iphone');
    });
    expect(committed).toBe(true);
    expect(result.current.showSearchMinLengthHint).toBe(false);
  });

  it('rejects too-short commits', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    let committed: boolean | undefined;
    act(() => {
      committed = result.current.evaluateCommit('i');
    });

    expect(committed).toBe(false);
    expect(result.current.showSearchMinLengthHint).toBe(true);
  });

  it('clears the hint once typing becomes searchable', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    act(() => {
      result.current.evaluateCommit('!!');
    });
    expect(result.current.showSearchMinLengthHint).toBe(true);

    act(() => {
      result.current.noteQueryChange('!!a');
    });
    expect(result.current.showSearchMinLengthHint).toBe(false);
  });

  it('keeps the hint while typing stays unsearchable', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    act(() => {
      result.current.evaluateCommit('!!');
    });

    act(() => {
      result.current.noteQueryChange('!!!');
    });
    expect(result.current.showSearchMinLengthHint).toBe(true);
  });

  it('clears the hint explicitly', () => {
    const { result } = renderHook(() => useSearchMinLengthHint());

    act(() => {
      result.current.evaluateCommit('!!');
    });
    expect(result.current.showSearchMinLengthHint).toBe(true);

    act(() => {
      result.current.clearHint();
    });
    expect(result.current.showSearchMinLengthHint).toBe(false);
  });
});
