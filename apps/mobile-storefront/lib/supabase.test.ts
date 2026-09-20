const mockState = {
  authSessionStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
  createClient: jest.fn(),
  expoExtra: {} as {
    supabaseAnonKey?: string;
    supabasePublishableKey?: string;
    supabaseUrl?: string;
  },
  netInfoFetch: jest.fn(),
  invoke: jest.fn(),
  platformOS: 'ios',
  processLock: jest.fn(),
  registerAuthRefreshLifecycle: jest.fn(),
  webSessionStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
};

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      get extra() {
        return mockState.expoExtra;
      },
    },
  },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: mockState.createClient,
  processLock: mockState.processLock,
}));

jest.mock(
  'react-native',
  () => ({
    Platform: {
      get OS() {
        return mockState.platformOS;
      },
    },
  }),
  { virtual: true }
);

jest.mock('./auth/auth-refresh-lifecycle', () => ({
  registerAuthRefreshLifecycle: mockState.registerAuthRefreshLifecycle,
}));

jest.mock('./auth/auth-session-storage', () => ({
  authSessionStorage: mockState.authSessionStorage,
  getDefaultSupabaseAuthStorageKey: (supabaseUrl: string) => {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${projectRef}-auth-token`;
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: (...args: unknown[]) => mockState.netInfoFetch(...args),
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('./logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
  trackError: jest.fn(),
}));

describe('storefront supabase client config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockState.expoExtra = {
      supabaseAnonKey: 'expo-anon-key',
      supabasePublishableKey: 'expo-publishable-key',
      supabaseUrl: 'https://expo-project.supabase.co',
    };
    mockState.platformOS = 'ios';
    mockState.netInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
    mockState.registerAuthRefreshLifecycle.mockReset();
    mockState.webSessionStorage.getItem.mockReset();
    mockState.webSessionStorage.removeItem.mockReset();
    mockState.webSessionStorage.setItem.mockReset();
    mockState.invoke.mockResolvedValue({ data: null, error: null });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: mockState.webSessionStorage,
      },
    });
    mockState.createClient.mockReturnValue({
      auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() },
      functions: {
        invoke: mockState.invoke,
      },
    });
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete (globalThis as { window?: unknown }).window;
  });

  it('falls back to expo extra publishable config when EXPO_PUBLIC env vars are empty', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = '';

    await import('./supabase');

    expect(mockState.createClient).toHaveBeenCalledWith(
      'https://expo-project.supabase.co',
      'expo-publishable-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
          persistSession: true,
          storageKey: 'sb-expo-project-auth-token',
          storage: expect.objectContaining({
            getItem: expect.any(Function),
            removeItem: expect.any(Function),
            setItem: expect.any(Function),
          }),
        }),
      })
    );
    const nativeAuthOptions = mockState.createClient.mock.calls[0]?.[2]?.auth;
    expect(nativeAuthOptions.lock).toBe(mockState.processLock);
    expect(mockState.registerAuthRefreshLifecycle).toHaveBeenCalledWith(
      mockState.createClient.mock.results[0]?.value.auth
    );
  });

  it('prefers EXPO_PUBLIC publishable key over all fallbacks', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://env-project.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'env-publishable-key';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'env-anon-key';

    await import('./supabase');

    expect(mockState.createClient).toHaveBeenCalledWith(
      'https://env-project.supabase.co',
      'env-publishable-key',
      expect.any(Object)
    );
  });

  it('temporarily falls back to the legacy anon key with a warning', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://env-project.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'env-anon-key';
    mockState.expoExtra = {
      supabaseAnonKey: 'expo-anon-key',
      supabaseUrl: 'https://expo-project.supabase.co',
    };
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await import('./supabase');

    expect(mockState.createClient).toHaveBeenCalledWith(
      'https://env-project.supabase.co',
      'env-anon-key',
      expect.any(Object)
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Supabase] Using legacy anon key fallback; migrate mobile-storefront builds to EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before end of 2026.'
    );

    consoleWarnSpy.mockRestore();
  });

  it('warns and skips createClient when credentials are missing', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = '';
    mockState.expoExtra = {};
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await import('./supabase');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Supabase] SUPABASE_URL is not configured. Set EXPO_PUBLIC_SUPABASE_URL or configure extra.supabaseUrl in app.json.'
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Supabase] SUPABASE_PUBLISHABLE_KEY is not configured. Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY or configure extra.supabasePublishableKey in app.json.'
    );
    expect(mockState.createClient).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('normalizes order totals to include assurance fees', async () => {
    mockState.invoke.mockResolvedValue({
      data: { taxAmount: 75, total: 1575 },
      error: null,
    });

    const { calculateCommerce } = await import('./commerce-brain');

    await expect(
      calculateCommerce('calculate_order', {
        subtotal: 1000,
        shippingFee: 500,
        taxRate: 0.075,
        assuranceFee: 100,
      })
    ).resolves.toEqual({
      taxAmount: 75,
      total: 1675,
    });
  });

  it('falls back to local order totals when the edge function request cannot be sent', async () => {
    mockState.invoke.mockRejectedValue(
      Object.assign(
        new Error('Failed to send a request to the Edge Function'),
        {
          name: 'FunctionsFetchError',
        }
      )
    );

    const { calculateCommerce } = await import('./commerce-brain');

    await expect(
      calculateCommerce('calculate_order', {
        subtotal: 1000,
        shippingFee: 500,
        taxRate: 0.075,
        assuranceFee: 100,
      })
    ).resolves.toEqual({
      taxAmount: 75,
      total: 1675,
    });
  });
});
