import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';

// Metro does not expose these resolver types for its JS config, so mirror only the tested shape.
type MetroResolution = {
  filePath: string;
  type: string;
};

type MetroResolveRequest = (
  context: unknown,
  moduleName: string,
  platform: string | null
) => MetroResolution;

type MetroResolver = (
  context: { resolveRequest: MetroResolveRequest },
  moduleName: string,
  platform: string | null
) => MetroResolution;

jest.mock('expo/metro-config', () => ({
  getDefaultConfig: () => ({
    resolver: {},
    // Worklets bundle mode writes serializer.createModuleIdFactory and wraps
    // transformer.getTransformOptions; the real Expo config always has these.
    serializer: {},
    transformer: {},
  }),
}));

const mockGetPostHogExpoConfig = jest.fn(
  (
    projectRoot: string,
    options: { getDefaultConfig: (root: string) => { resolver: object } }
  ) => options.getDefaultConfig(projectRoot)
);

jest.mock('posthog-react-native/metro', () => ({
  getPostHogExpoConfig: mockGetPostHogExpoConfig,
}));

const mockGetSentryExpoConfig = jest.fn(
  (
    projectRoot: string,
    options: { getDefaultConfig: (root: string) => { resolver: object } }
  ) => options.getDefaultConfig(projectRoot)
);

jest.mock('@sentry/react-native/metro', () => ({
  getSentryExpoConfig: mockGetSentryExpoConfig,
}));

const mockGetBundleModeMetroConfig = jest.fn(
  (inputConfig: { serializer?: Record<string, unknown> }) => ({
    ...inputConfig,
    serializer: {
      ...inputConfig.serializer,
      createModuleIdFactory: () => 'bundle-mode',
    },
  })
);

jest.mock('react-native-worklets/bundleMode', () => ({
  getBundleModeMetroConfig: mockGetBundleModeMetroConfig,
}));

const metroConfig = jest.requireActual<{
  resolver: { blockList?: RegExp[]; resolveRequest?: MetroResolver };
  watchFolders?: string[];
}>('./metro.config.js');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

function getResolver(): MetroResolver {
  const resolveRequest = metroConfig.resolver.resolveRequest;

  expect(resolveRequest).toEqual(expect.any(Function));
  if (!resolveRequest) {
    throw new Error('Expected Metro to define a custom dependency resolver.');
  }

  return resolveRequest;
}

function withWorkletsBundleModeEnv<T>(value: string, callback: () => T): T {
  const originalValue = process.env.BACI_MOBILE_STOREFRONT_WORKLETS_BUNDLE_MODE;

  process.env.BACI_MOBILE_STOREFRONT_WORKLETS_BUNDLE_MODE = value;

  try {
    return callback();
  } finally {
    if (originalValue === undefined) {
      delete process.env.BACI_MOBILE_STOREFRONT_WORKLETS_BUNDLE_MODE;
    } else {
      process.env.BACI_MOBILE_STOREFRONT_WORKLETS_BUNDLE_MODE = originalValue;
    }
  }
}

describe('Metro web runtime resolution', () => {
  it('uses PostHog Metro instrumentation for React Native source maps', () => {
    expect(mockGetPostHogExpoConfig).toHaveBeenCalledWith(projectRoot, {
      getDefaultConfig: expect.any(Function),
    });
  });

  it('composes Sentry instrumentation with PostHog source maps', () => {
    expect(mockGetSentryExpoConfig).toHaveBeenCalledWith(
      projectRoot,
      expect.objectContaining({
        autoWrapExpoRouterErrorBoundary: true,
        getDefaultConfig: expect.any(Function),
        includeWebFeedback: false,
        includeWebReplay: false,
      })
    );
  });

  it('watches root node_modules so pnpm hoisted dependencies resolve', () => {
    expect(metroConfig.watchFolders).toEqual(
      expect.arrayContaining([
        projectRoot,
        path.resolve(workspaceRoot, 'node_modules'),
        path.resolve(workspaceRoot, 'packages/shared'),
        path.resolve(workspaceRoot, 'packages/tiktok-business'),
      ])
    );
  });

  it('does not block pnpm virtual store packages', () => {
    const pnpmPackagePath = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      'react@19.2.3',
      'node_modules',
      'react',
      'index.js'
    );

    expect(
      metroConfig.resolver.blockList?.some((pattern) =>
        pattern.test(pnpmPackagePath)
      )
    ).toBe(false);
  });

  it('resolves Zustand middleware to its classic-script-safe build on web', () => {
    const fallbackResolve = jest.fn<MetroResolveRequest>(() => ({
      filePath: '/fallback.js',
      type: 'sourceFile',
    }));

    const resolution = getResolver()(
      { resolveRequest: fallbackResolve },
      'zustand/middleware',
      'web'
    );

    expect(resolution).toEqual({
      filePath: require.resolve('zustand/middleware'),
      type: 'sourceFile',
    });
    expect(fallbackResolve).not.toHaveBeenCalled();
  });

  it.each([
    'ios',
    'android',
  ])('preserves default Zustand middleware resolution on %s', (platform) => {
    const fallbackResolution = {
      filePath: '/fallback.js',
      type: 'sourceFile',
    };
    const fallbackResolve = jest.fn<MetroResolveRequest>(
      () => fallbackResolution
    );

    const resolution = getResolver()(
      { resolveRequest: fallbackResolve },
      'zustand/middleware',
      platform
    );

    expect(resolution).toBe(fallbackResolution);
    expect(fallbackResolve).toHaveBeenCalledWith(
      expect.any(Object),
      'zustand/middleware',
      platform
    );
  });

  it('preserves default resolution for unrelated web modules', () => {
    const fallbackResolution = {
      filePath: '/fallback.js',
      type: 'sourceFile',
    };
    const fallbackResolve = jest.fn<MetroResolveRequest>(
      () => fallbackResolution
    );

    const resolution = getResolver()(
      { resolveRequest: fallbackResolve },
      'react',
      'web'
    );

    expect(resolution).toBe(fallbackResolution);
    expect(fallbackResolve).toHaveBeenCalledWith(
      expect.any(Object),
      'react',
      'web'
    );
  });

  it('keeps worklets bundle mode disabled by default for expo-updates OTA safety', () => {
    const serializer = (
      metroConfig as unknown as {
        serializer: { createModuleIdFactory?: unknown };
      }
    ).serializer;

    expect(serializer.createModuleIdFactory).toBeUndefined();
    expect(mockGetBundleModeMetroConfig).not.toHaveBeenCalled();
  });

  it('applies worklets bundle mode as the outermost config wrapper when opted in', () => {
    mockGetBundleModeMetroConfig.mockClear();

    const enabledMetroConfig = withWorkletsBundleModeEnv('1', () => {
      jest.resetModules();
      return jest.requireActual<{
        serializer: { createModuleIdFactory?: unknown };
      }>('./metro.config.js');
    });

    expect(mockGetBundleModeMetroConfig).toHaveBeenCalledTimes(1);
    expect(enabledMetroConfig.serializer.createModuleIdFactory).toEqual(
      expect.any(Function)
    );
  });
});
