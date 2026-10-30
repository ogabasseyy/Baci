import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiClient, mockApplication, mockPlatform } = vi.hoisted(() => ({
  mockApiClient: vi.fn(),
  mockApplication: {
    nativeApplicationVersion: '2.1.530' as string | null,
    nativeBuildVersion: '612' as string | null,
  },
  mockPlatform: {
    OS: 'android' as string,
    Version: 36 as number | string,
    constants: {} as Record<string, unknown>,
  },
}));

vi.mock('./api-client', () => ({ apiClient: mockApiClient }));
vi.mock('expo-application', () => mockApplication);
vi.mock('react-native', () => ({ Platform: mockPlatform }));

import {
  collectFeedbackDiagnostics,
  sendFeedbackReport,
} from './feedback-report';

beforeEach(() => {
  mockApiClient.mockReset();
  mockApplication.nativeApplicationVersion = '2.1.530';
  mockApplication.nativeBuildVersion = '612';
  mockPlatform.OS = 'android';
  mockPlatform.Version = 36;
  mockPlatform.constants = { Brand: 'google', Model: 'Pixel 9', Release: '16' };
});

describe('collectFeedbackDiagnostics', () => {
  it('describes an Android device with model, OS release and app build', () => {
    expect(collectFeedbackDiagnostics('/orders')).toEqual({
      screen: '/orders',
      platform: 'android',
      appVersion: '2.1.530 (612)',
      device: 'google Pixel 9 · Android 16',
    });
  });

  it('describes an iOS device by OS version', () => {
    mockPlatform.OS = 'ios';
    mockPlatform.Version = '26.1';

    expect(collectFeedbackDiagnostics('/')).toMatchObject({
      platform: 'ios',
      device: 'iOS 26.1',
    });
  });

  it('falls back to the API level when Android constants are missing', () => {
    mockPlatform.constants = {};

    expect(collectFeedbackDiagnostics('/').device).toBe('Android 36');
  });

  it('leaves the app version out when the native version is unknown', () => {
    mockApplication.nativeApplicationVersion = null;

    expect(collectFeedbackDiagnostics('/').appVersion).toBeUndefined();
  });

  it('shows the version alone when there is no build number', () => {
    mockApplication.nativeBuildVersion = null;

    expect(collectFeedbackDiagnostics('/').appVersion).toBe('2.1.530');
  });

  it('drops a blank screen', () => {
    expect(collectFeedbackDiagnostics('  ').screen).toBeUndefined();
    expect(collectFeedbackDiagnostics(null).screen).toBeUndefined();
  });
});

describe('sendFeedbackReport', () => {
  it('POSTs the trimmed message with the diagnostics', async () => {
    mockApiClient.mockResolvedValue({ id: 'fb-1', emailed: true });

    await expect(
      sendFeedbackReport('  App froze  ', {
        screen: '/orders',
        platform: 'ios',
      })
    ).resolves.toEqual({ id: 'fb-1', emailed: true });
    expect(mockApiClient).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        message: 'App froze',
        screen: '/orders',
        platform: 'ios',
      }),
    });
  });

  it('passes server errors through to the caller', async () => {
    mockApiClient.mockRejectedValue(new Error('Too many requests'));

    await expect(sendFeedbackReport('x', {})).rejects.toThrow(
      'Too many requests'
    );
  });
});
