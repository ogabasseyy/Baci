let mockProject;
let mockFinalizedModCalls = [];

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

function runPluginWithPhases({
  bundleShellScript = '',
  dsymShellScript = '',
  dsymInputPaths = [],
} = {}) {
  const bundlePhase = {
    shellScript: JSON.stringify(bundleShellScript),
  };
  const dsymUploadPhase = {
    inputPaths: dsymInputPaths,
    shellScript: JSON.stringify(dsymShellScript),
  };
  mockProject = {
    pbxItemByComment: jest.fn((phaseName) => {
      if (phaseName === BUNDLE_PHASE_NAME) {
        return bundlePhase;
      }
      if (phaseName === DSYM_UPLOAD_PHASE_NAME) {
        return dsymUploadPhase;
      }
      return undefined;
    }),
  };

  withPostHogXcodeCliPath({ name: 'Ogabassey', slug: 'ogabassey' });

  return {
    bundlePhase,
    bundleScript: JSON.parse(bundlePhase.shellScript),
    dsymUploadPhase,
    dsymScript: JSON.parse(dsymUploadPhase.shellScript),
  };
}

describe('withPostHogXcodeCliPath with Sentry 8.28', () => {
  afterEach(() => {
    mockProject = undefined;
    mockFinalizedModCalls = [];
  });

  describe('Sentry 8.28 joined bundle line', () => {
    const NODE = '"$NODE_BINARY" --print';
    const sentry = `\`${NODE} "require('path').dirname(require.resolve('@sentry/react-native/package.json')) + '/scripts/sentry-xcode.sh'"\``;
    const posthog = `\`${NODE} "require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog-xcode.sh')"\``;
    const reactNative = `\`${NODE} "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"\``;
    // Exact line produced by `expo prebuild` with @sentry/react-native 8.28.0.
    const joinedLine = `/bin/sh "${sentry}" "${posthog} "${reactNative}""`;
    const bundleShellScript = `export PROJECT_ROOT="$PROJECT_DIR"/..\n\n${joinedLine}\n`;

    // Counts the arguments /bin/sh would receive, with node stubbed out.
    const countShArguments = (line) =>
      Number(
        require('node:child_process')
          .execFileSync('bash', [
            '-c',
            `stub() { echo "/stub/$#"; }; NODE_BINARY=stub; sh() { echo $#; }; ${line.replace('/bin/sh', 'sh')}`,
          ])
          .toString()
          .trim()
      );

    it('reproduces the failure: Sentry sees the two scripts as one argument', () => {
      expect(countShArguments(joinedLine)).toBe(2);
    });

    it('passes the PostHog and React Native scripts as separate arguments', () => {
      const { bundleScript } = runPluginWithPhases({ bundleShellScript });
      const line = bundleScript
        .split('\n')
        .find((candidate) => candidate.includes('sentry-xcode.sh'));

      expect(line).toBe(`/bin/sh "${sentry}" "${posthog}" "${reactNative}"`);
      expect(countShArguments(line)).toBe(3);
    });

    it('is idempotent across incremental prebuilds', () => {
      const first = runPluginWithPhases({ bundleShellScript }).bundleScript;
      const second = runPluginWithPhases({
        bundleShellScript: first,
      }).bundleScript;

      expect(second).toBe(first);
    });

    it('leaves the pre-8.28 unquoted Sentry line alone', () => {
      const legacy = `/bin/sh ${sentry} ${posthog} ${reactNative}`;
      const { bundleScript } = runPluginWithPhases({
        bundleShellScript: `export PROJECT_ROOT="$PROJECT_DIR"/..\n${legacy}\n`,
      });

      expect(bundleScript).toContain(legacy);
    });
  });
});
