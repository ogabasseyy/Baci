import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useOxygenPhoneMarker } from './use-oxygen-phone-marker';

describe('scoped phone timing recovery', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  it('restores only the original timestamp without restarting five minutes', async () => {
    const time = new Date(Date.now() - 60000).toISOString();
    const first = renderHook(() =>
      useOxygenPhoneMarker('profile:user:merchant:order:workflow')
    );
    act(() => first.result.current.mark(time));
    await waitFor(() =>
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'profile:user:merchant:order:workflow:oxygen-phone-sent-at',
        time
      )
    );
    first.unmount();
    const second = renderHook(() =>
      useOxygenPhoneMarker('profile:user:merchant:order:workflow')
    );
    await waitFor(() => expect(second.result.current.sentAt).toBe(time));
  });
  it('does not restore another user/order timing', async () => {
    await AsyncStorage.setItem(
      'scope-a:oxygen-phone-sent-at',
      new Date().toISOString()
    );
    const hook = renderHook(() => useOxygenPhoneMarker('scope-b'));
    expect(hook.result.current.sentAt).toBeNull();
  });
});
