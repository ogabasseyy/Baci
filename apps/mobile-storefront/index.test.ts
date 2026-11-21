import { describe, expect, it, jest } from '@jest/globals';

describe('app entrypoint', () => {
  it('initializes error monitoring before loading Expo Router', () => {
    const callOrder: string[] = [];
    jest.resetModules();
    jest.doMock('react-native-gesture-handler', () => ({}));
    jest.doMock('react-native-reanimated', () => ({}));
    jest.doMock('expo-crypto', () => ({ getRandomValues: jest.fn() }));
    jest.doMock('./services/error-monitoring', () => ({
      initializeErrorMonitoring: () => callOrder.push('monitoring'),
    }));
    jest.doMock('expo-router/entry', () => {
      callOrder.push('router');
      return {};
    });

    jest.isolateModules(() => {
      require('./index.js');
    });

    expect(callOrder).toEqual(['monitoring', 'router']);
  });

  it('still loads Expo Router when error monitoring is disabled', () => {
    const routerEntry = jest.fn();
    jest.resetModules();
    jest.doMock('react-native-gesture-handler', () => ({}));
    jest.doMock('react-native-reanimated', () => ({}));
    jest.doMock('expo-crypto', () => ({ getRandomValues: jest.fn() }));
    jest.doMock('./services/error-monitoring', () => ({
      initializeErrorMonitoring: () => false,
    }));
    jest.doMock('expo-router/entry', () => {
      routerEntry();
      return {};
    });

    jest.isolateModules(() => {
      require('./index.js');
    });

    expect(routerEntry).toHaveBeenCalledTimes(1);
  });

  it('installs the Oxygen staging profile before loading app modules', () => {
    const original = process.env.EXPO_PUBLIC_OXYGEN_STAGING;
    process.env.EXPO_PUBLIC_OXYGEN_STAGING = '1';
    const callOrder: string[] = [];
    jest.resetModules();
    jest.doMock('react-native-gesture-handler', () => ({}));
    jest.doMock('react-native-reanimated', () => ({}));
    jest.doMock('expo-crypto', () => ({ getRandomValues: jest.fn() }));
    jest.doMock('./lib/oxygen-staging-startup', () => ({
      startOxygenStagingRuntime: () => callOrder.push('staging'),
    }));
    jest.doMock('./services/error-monitoring', () => {
      callOrder.push('services');
      return { initializeErrorMonitoring: () => callOrder.push('monitoring') };
    });
    jest.doMock('expo-router/entry', () => {
      callOrder.push('router');
      return {};
    });

    try {
      jest.isolateModules(() => {
        require('./index.js');
      });
      expect(callOrder).toEqual(['staging', 'services', 'router']);
    } finally {
      if (original === undefined) delete process.env.EXPO_PUBLIC_OXYGEN_STAGING;
      else process.env.EXPO_PUBLIC_OXYGEN_STAGING = original;
      jest.dontMock('./lib/oxygen-staging-startup');
    }
  });
});
