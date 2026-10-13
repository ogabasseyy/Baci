import { act, renderHook } from '@testing-library/react-native';
import { useRepairPickupBack } from './use-repair-pickup-back';

describe('pickup native back', () => {
  it('returns to form only before an attempt and preserves in-memory recovery afterward', () => {
    const navigation = { current: null as (() => void) | null };
    const inFlight = { current: false };
    const back = jest.fn();
    const { rerender, unmount } = renderHook<void, { canEdit: boolean }>(
      ({ canEdit }) => useRepairPickupBack(navigation, canEdit, inFlight, back),
      { initialProps: { canEdit: true } }
    );
    act(() => navigation.current?.());
    expect(back).toHaveBeenCalledTimes(1);
    rerender({ canEdit: false });
    act(() => navigation.current?.());
    expect(back).toHaveBeenCalledTimes(1);
    unmount();
    expect(navigation.current).toBeNull();
  });
  it('does not leave during a payment request before a ticket is returned', () => {
    const navigation = { current: null as (() => void) | null };
    const back = jest.fn();
    renderHook(() =>
      useRepairPickupBack(navigation, true, { current: true }, back)
    );
    act(() => navigation.current?.());
    expect(back).not.toHaveBeenCalled();
  });
});
