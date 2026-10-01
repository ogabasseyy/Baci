let mockProject;
let mockFinalizedModCalls = [];

const { IOSConfig } = require('@expo/config-plugins');

jest.mock('@expo/config-plugins', () => ({
  IOSConfig: {
    Paths: {
      getPBXProjectPath: jest.fn(),
    },
    XcodeUtils: {
      getPbxproj: jest.fn(),
    },
  },
  withFinalizedMod: (config, [platform, action]) => {
    mockFinalizedModCalls.push({ action, platform });
    return config;
  },
  withXcodeProject: (config, action) =>
    action({
      ...config,
      modResults: mockProject,
    }),
}));

const withPostHogXcodeCliPath = require('./withPostHogXcodeCliPath');

const BUNDLE_PHASE_NAME = 'Bundle React Native code and images';
const DSYM_UPLOAD_PHASE_NAME = 'Upload PostHog Debug Symbols';
const EXPECTED_SKIP_ON_CONFLICT_EXPORT = 'export POSTHOG_SKIP_ON_CONFLICT=1';

function runPluginWithBundleScript(bundleShellScript) {
  const bundlePhase = { shellScript: JSON.stringify(bundleShellScript) };
  const dsymUploadPhase = { inputPaths: [], shellScript: JSON.stringify('') };
  mockProject = {
    pbxItemByComment: jest.fn((phaseName) => {
      if (phaseName === BUNDLE_PHASE_NAME) return bundlePhase;
      if (phaseName === DSYM_UPLOAD_PHASE_NAME) return dsymUploadPhase;
      return undefined;
    }),
  };

  withPostHogXcodeCliPath({ name: 'Ogabassey', slug: 'ogabassey' });
  return JSON.parse(bundlePhase.shellScript);
}

describe('withPostHogXcodeCliPath Hermes conflict guard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    IOSConfig.Paths.getPBXProjectPath.mockReset();
    IOSConfig.XcodeUtils.getPbxproj.mockReset();
    mockProject = undefined;
    mockFinalizedModCalls = [];
  });

  it('skips Hermes upload conflicts without failing the bundle phase', () => {
    const bundleScript = runPluginWithBundleScript(
      `export PROJECT_ROOT="$PROJECT_DIR"/..\n/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"\n`
    );

    expect(bundleScript).toContain(
      `${EXPECTED_SKIP_ON_CONFLICT_EXPORT}\n/bin/sh`
    );
  });

  it('does not duplicate the Hermes conflict guard', () => {
    const bundleScript = runPluginWithBundleScript(
      `export PROJECT_ROOT="$PROJECT_DIR"/..\n${EXPECTED_SKIP_ON_CONFLICT_EXPORT}\n/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"\n`
    );

    expect(bundleScript.match(/POSTHOG_SKIP_ON_CONFLICT/g)).toHaveLength(1);
  });

  it('guards an earlier Hermes invocation when a later guard already exists', () => {
    const bundleScript = runPluginWithBundleScript(
      `export PROJECT_ROOT="$PROJECT_DIR"/..\n/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"\n${EXPECTED_SKIP_ON_CONFLICT_EXPORT}\n`
    );

    expect(bundleScript.indexOf(EXPECTED_SKIP_ON_CONFLICT_EXPORT)).toBeLessThan(
      bundleScript.indexOf('posthog-xcode.sh')
    );
    expect(bundleScript.match(/POSTHOG_SKIP_ON_CONFLICT/g)).toHaveLength(2);
  });
});
