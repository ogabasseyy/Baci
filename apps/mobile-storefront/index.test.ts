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
});
