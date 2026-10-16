import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

describe('mobile env', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    }
    jest.unmock('expo-constants');
    jest.resetModules();
  });

  it('reads a valid public API URL from process env', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://usebaci.com';
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));

    const { EXPO_PUBLIC_API_URL } = await import('./env');

    expect(EXPO_PUBLIC_API_URL).toBe('https://usebaci.com');
  });

  it('uses the default API URL when process env and Expo extra are unset', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));

    const { EXPO_PUBLIC_API_URL } = await import('./env');

    expect(EXPO_PUBLIC_API_URL).toBe('https://usebaci.com');
  });

  it('reads and normalizes the Expo extra API URL when process env is unset', async () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: { apiUrl: '  https://some-expo-fallback.test  ' },
        },
      },
    }));

    const { EXPO_PUBLIC_API_URL } = await import('./env');

    expect(EXPO_PUBLIC_API_URL).toBe('https://some-expo-fallback.test');
  });

  it('throws when the runtime API URL is malformed', async () => {
    process.env.EXPO_PUBLIC_API_URL = 'not-a-url';
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));

    await expect(import('./env')).rejects.toThrow(
      'Invalid mobile environment configuration'
    );
  });

  it('reports the raw public API URL when schema validation fails', async () => {
    process.env.EXPO_PUBLIC_API_URL = ' not-a-url ';
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: {} } },
    }));

    await expect(import('./env')).rejects.toThrow(
      'Received EXPO_PUBLIC_API_URL=" not-a-url "'
    );
  });
});
