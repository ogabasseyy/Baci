import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { triggerHaptic } from './use-haptics';

describe('triggerHaptic', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS });
    jest.clearAllMocks();
  });

  it('fires the success notification on iOS', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    triggerHaptic('success');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success
    );
  });

  it('swallows an asynchronous rejection from the native haptics call', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    const rejection = Promise.reject(new Error('no haptics engine'));
    const caught = jest.spyOn(rejection, 'catch');
    jest.mocked(Haptics.notificationAsync).mockReturnValueOnce(rejection);
    expect(() => triggerHaptic('success')).not.toThrow();
    await Promise.resolve();
    expect(caught).toHaveBeenCalled();
  });

  it('does nothing off iOS', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    triggerHaptic('success');
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
