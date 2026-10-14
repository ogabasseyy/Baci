import { act, renderHook } from '@testing-library/react-native';
import { useNativeInputDraft } from './use-native-input-draft';

describe('native input drafts', () => {
  it('retains raw native edits while the form stores normalized text', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useNativeInputDraft(value),
      { initialProps: { value: '' } }
    );
    act(() => {
      result.current.setDraft(' Demo@Example.com ', 'demo@example.com');
      rerender({ value: 'demo@example.com' });
    });
    expect(result.current.displayValue).toBe(' Demo@Example.com ');
  });

  it('clears an external reset and never restores a stale matching draft', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useNativeInputDraft(value),
      { initialProps: { value: '08012345678' } }
    );
    act(() => result.current.setDraft('080 1234 5678', '08012345678'));
    expect(result.current.displayValue).toBe('080 1234 5678');
    rerender({ value: '' });
    expect(result.current.displayValue).toBe('');
    rerender({ value: '08012345678' });
    expect(result.current.displayValue).toBe('08012345678');
  });

  it('settles on the formatted form value when blur clears the draft', () => {
    const { result } = renderHook(() =>
      useNativeInputDraft('2348012345678', '+234 801 234 5678')
    );
    act(() => result.current.setDraft('080 1234 5678', '2348012345678'));
    expect(result.current.displayValue).toBe('080 1234 5678');
    act(() => result.current.clearDraft());
    expect(result.current.displayValue).toBe('+234 801 234 5678');
  });
});
