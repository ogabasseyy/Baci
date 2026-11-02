import { NativeModules } from 'react-native';
import {
  captureSavingsActivityGeneration,
  isSavingsActivityGenerationCurrent,
  setSavingsActivityOwner,
} from './savings-activity-lifecycle';

it('denies all owners before auth explicitly initializes', () => {
  expect(captureSavingsActivityGeneration('owner-a')).toBeNull();
  expect(isSavingsActivityGenerationCurrent('owner-a', 0)).toBe(false);
});

it('clears inherited activity on the first signed-out cold-start initialization only', () => {
  jest.isolateModules(() => {
    const clear = jest.fn();
    NativeModules.SavingsLiveActivity = { clear };
    const lifecycle =
      require('./savings-activity-lifecycle') as typeof import('./savings-activity-lifecycle');

    expect(lifecycle.captureSavingsActivityGeneration('owner-a')).toBeNull();
    expect(lifecycle.isSavingsActivityOwnerCurrent('owner-a')).toBe(false);
    lifecycle.setSavingsActivityOwner(null);
    lifecycle.setSavingsActivityOwner(null);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(lifecycle.captureSavingsActivityGeneration('owner-a')).toBeNull();
  });
});

it('clears on identity changes and fences completions from the prior owner', () => {
  const clear = jest.fn();
  NativeModules.SavingsLiveActivity = { clear };
  setSavingsActivityOwner('owner-a');
  const token = captureSavingsActivityGeneration('owner-a');
  setSavingsActivityOwner('owner-a');
  expect(clear).toHaveBeenCalledTimes(1);
  expect(isSavingsActivityGenerationCurrent('owner-a', token)).toBe(true);

  setSavingsActivityOwner(null);
  expect(clear).toHaveBeenCalledTimes(2);
  expect(isSavingsActivityGenerationCurrent('owner-a', token)).toBe(false);

  setSavingsActivityOwner('owner-b');
  expect(clear).toHaveBeenCalledTimes(3);
  expect(isSavingsActivityGenerationCurrent('owner-a', token)).toBe(false);
});

it('does not block an auth identity change when the native feature fails', () => {
  NativeModules.SavingsLiveActivity = {
    clear: () => {
      throw new Error('unavailable');
    },
  };
  expect(() => setSavingsActivityOwner(null)).not.toThrow();
  expect(captureSavingsActivityGeneration('owner-b')).toBeNull();
});
