import { renderHook } from '@testing-library/react-native';
import { useCloseSheetOnBlur } from './use-close-sheet-on-blur';

const listeners: Record<string, () => void> = {};
const mockNavigation = {
  addListener: jest.fn((event: string, listener: () => void) => {
    listeners[event] = listener;
    return () => {
      delete listeners[event];
    };
  }),
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

describe('bugfix: the IMEI pay sheet followed the customer to the wallet (Fable walk 14)', () => {
  it('closes an open sheet when its screen loses focus', () => {
    const close = jest.fn();
    renderHook(() => useCloseSheetOnBlur({ step: 'outcome', close }));
    listeners.blur?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves a closed sheet alone, and stops listening once unmounted', () => {
    const close = jest.fn();
    const hook = renderHook(() =>
      useCloseSheetOnBlur({ step: 'closed', close })
    );
    listeners.blur?.();
    expect(close).not.toHaveBeenCalled();
    hook.unmount();
    expect(listeners.blur).toBeUndefined();
  });
});
