import { vi } from 'vitest';

const mockPlatform = vi.hoisted(() => ({ OS: 'ios' }));
const mockNativeModule = vi.hoisted(() => ({
  flush: vi.fn(),
  identify: vi.fn(),
  initialize: vi.fn(async () => true),
  isDebugMode: vi.fn(() => false),
  isInitialized: vi.fn(() => true),
  logout: vi.fn(),
  requestTrackingAuthorization: vi.fn(async () => 3),
  trackEvent: vi.fn(() => true),
}));
const mockRequireNativeModule = vi.hoisted(() => vi.fn(() => mockNativeModule));

vi.mock('react-native', () => ({
  Platform: mockPlatform,
}));

vi.mock('expo', () => ({
  requireNativeModule: mockRequireNativeModule,
}));

describe('@baci/tiktok-business', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPlatform.OS = 'ios';
    mockRequireNativeModule.mockClear();
    Object.values(mockNativeModule).forEach((mock) => {
      mock.mockClear();
    });
  });

  it('initializes the native iOS module lazily', async () => {
    const TikTokBusiness = await import('./index');

    await expect(TikTokBusiness.initialize()).resolves.toBe(true);
    expect(mockRequireNativeModule).toHaveBeenCalledWith('BaciTikTokBusiness');
    expect(mockNativeModule.initialize).toHaveBeenCalledTimes(1);
  });

  it('propagates native initialization failures', async () => {
    const initializationError = new Error('TikTok initialization failed');
    mockNativeModule.initialize.mockRejectedValueOnce(initializationError);
    const TikTokBusiness = await import('./index');

    await expect(TikTokBusiness.initialize()).rejects.toBe(
      initializationError
    );
  });

  it('normalizes event data before passing events to native iOS', async () => {
    const TikTokBusiness = await import('./index');

    const tracked = TikTokBusiness.trackEvent('Purchase', 'event-1', [
      { key: ' value ', value: 2500 },
      { key: 'currency', value: 'NGN' },
      { key: ' ', value: 'ignored' },
    ]);

    expect(tracked).toBe(true);
    expect(mockNativeModule.trackEvent).toHaveBeenCalledWith(
      'Purchase',
      'event-1',
      [
        { key: 'value', value: '2500' },
        { key: 'currency', value: 'NGN' },
      ]
    );
  });

  it('uses no-op behavior on non-iOS platforms', async () => {
    mockPlatform.OS = 'android';
    const TikTokBusiness = await import('./index');

    await expect(TikTokBusiness.initialize()).resolves.toBe(false);
    expect(TikTokBusiness.trackEvent('LaunchApp')).toBe(false);
    await expect(
      TikTokBusiness.requestTrackingAuthorization()
    ).resolves.toBeNull();
    expect(
      mockNativeModule.requestTrackingAuthorization
    ).not.toHaveBeenCalled();
    expect(mockRequireNativeModule).not.toHaveBeenCalled();
  });
});
