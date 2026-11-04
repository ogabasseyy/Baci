let mockProject;
let mockFinalizedModCalls = [];

const fs = require('node:fs');
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
const PHASE_TYPE = 'PBXShellScriptBuildPhase';
const EXPECTED_PATH_EXPORT =
  'export PATH="$PROJECT_ROOT/node_modules/.bin:$PROJECT_ROOT/../../node_modules/.bin:$PATH"';
const EXPECTED_DSYM_INPUT_PATH = `"\${DWARF_DSYM_FOLDER_PATH}/\${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/\${PRODUCT_NAME}"`;

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

describe('withPostHogXcodeCliPath', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    IOSConfig.Paths.getPBXProjectPath.mockReset();
    IOSConfig.XcodeUtils.getPbxproj.mockReset();
    mockProject = undefined;
    mockFinalizedModCalls = [];
  });

  it('prepends app and workspace node bins before the PostHog Xcode wrapper runs', () => {
    const { bundleScript } = runPluginWithPhases({
      bundleShellScript: `export PROJECT_ROOT="$PROJECT_DIR"/..

/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"
`,
    });

    expect(bundleScript).toContain(`export PROJECT_ROOT="$PROJECT_DIR"/..
${EXPECTED_PATH_EXPORT}
`);
    expect(bundleScript).toContain('posthog-xcode.sh');
  });

  it('upgrades the older app-only PATH patch without duplicating it', () => {
    const { bundleScript } = runPluginWithPhases({
      bundleShellScript: `export PROJECT_ROOT="$PROJECT_DIR"/..
export PATH="$PROJECT_ROOT/node_modules/.bin:$PATH"

/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"
`,
    });

    expect(bundleScript).toContain(EXPECTED_PATH_EXPORT);
    expect(
      bundleScript.match(/PROJECT_ROOT\/node_modules\/\.bin/g)
    ).toHaveLength(1);
  });

  it('leaves unrelated Xcode phases unchanged', () => {
    const { bundleScript } = runPluginWithPhases({
      bundleShellScript: `export PROJECT_ROOT="$PROJECT_DIR"/..
/bin/sh "$PROJECT_ROOT/node_modules/react-native/scripts/react-native-xcode.sh"
`,
    });

    expect(bundleScript).not.toContain(EXPECTED_PATH_EXPORT);
  });

  it('does not throw when the PostHog phases have not been created yet', () => {
    mockProject = {
      pbxItemByComment: jest.fn(() => undefined),
    };

    expect(() =>
      withPostHogXcodeCliPath({ name: 'Ogabassey', slug: 'ogabassey' })
    ).not.toThrow();
  });

  it('looks up the generated bundle phase by Xcode comment and type', () => {
    runPluginWithPhases({
      bundleShellScript: `export PROJECT_ROOT="$PROJECT_DIR"/..
/bin/sh "$PROJECT_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh"
`,
    });

    expect(mockProject.pbxItemByComment).toHaveBeenCalledWith(
      BUNDLE_PHASE_NAME,
      PHASE_TYPE
    );
  });

  it('patches the generated PostHog dSYM upload phase for pnpm CLI lookup and dSYM readiness', () => {
    const { dsymScript, dsymUploadPhase } = runPluginWithPhases({
      dsymShellScript: `# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.
if [ -n "$SKIP_DSYM_UPLOAD" ]; then
  exit 0
fi
PODS_SCRIPT="\${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
SPM_SCRIPT="\${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"
/bin/sh "$PODS_SCRIPT"
/bin/sh "$SPM_SCRIPT"
`,
    });

    expect(dsymScript).toContain('export PROJECT_ROOT="$PROJECT_DIR"/..');
    expect(dsymScript).toContain(EXPECTED_PATH_EXPORT);
    expect(dsymScript).toContain(
      'PostHog dSYM upload is best-effort; never fail the app archive.'
    );
    expect(dsymScript).toContain('set +e');
    expect(dsymScript).toContain('if ! /bin/sh "$PODS_SCRIPT"; then');
    expect(dsymScript).toContain('if ! /bin/sh "$SPM_SCRIPT"; then');
    expect(dsymScript).toContain(
      'warning: PostHog dSYM upload failed; continuing archive.'
    );
    expect(dsymScript.trimEnd().endsWith('exit 0')).toBe(true);
    expect(dsymUploadPhase.inputPaths).toContain(EXPECTED_DSYM_INPUT_PATH);
  });

  it('does not duplicate the generated dSYM upload PATH or input path', () => {
    const { dsymScript, dsymUploadPhase } = runPluginWithPhases({
      dsymInputPaths: [EXPECTED_DSYM_INPUT_PATH],
      dsymShellScript: `# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.
${EXPECTED_PATH_EXPORT}
PODS_SCRIPT="\${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
/bin/sh "$PODS_SCRIPT"
`,
    });

    expect(dsymScript.match(/PROJECT_ROOT\/node_modules\/\.bin/g)).toHaveLength(
      1
    );
    expect(dsymScript).toContain('export PROJECT_ROOT="$PROJECT_DIR"/..');
    expect(dsymUploadPhase.inputPaths).toEqual([EXPECTED_DSYM_INPUT_PATH]);
  });

  it('does not duplicate the dSYM upload failure warning wrapper', () => {
    const { dsymScript } = runPluginWithPhases({
      dsymShellScript: `# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.
export PROJECT_ROOT="$PROJECT_DIR"/..
${EXPECTED_PATH_EXPORT}
PODS_SCRIPT="\${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
if ! /bin/sh "$PODS_SCRIPT"; then
  echo "warning: PostHog dSYM upload failed; continuing archive. Native crash symbolication may be incomplete."
fi
`,
    });

    expect(dsymScript.match(/PostHog dSYM upload failed/g)).toHaveLength(1);
  });

  it('wraps the SPM dSYM upload path when only the Pods path was already wrapped', () => {
    const { dsymScript } = runPluginWithPhases({
      dsymShellScript: `# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.
export PROJECT_ROOT="$PROJECT_DIR"/..
${EXPECTED_PATH_EXPORT}
PODS_SCRIPT="\${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
SPM_SCRIPT="\${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"
if [ -f "$PODS_SCRIPT" ]; then
  if ! /bin/sh "$PODS_SCRIPT"; then
  echo "warning: PostHog dSYM upload failed; continuing archive. Native crash symbolication may be incomplete."
fi
elif [ -f "$SPM_SCRIPT" ]; then
  /bin/sh "$SPM_SCRIPT"
fi
`,
    });

    expect(dsymScript).toContain('if ! /bin/sh "$PODS_SCRIPT"; then');
    expect(dsymScript).toContain('if ! /bin/sh "$SPM_SCRIPT"; then');
    expect(dsymScript.match(/PostHog dSYM upload failed/g)).toHaveLength(2);
  });

  it('does not double-wrap indented Xcode dSYM upload guards', () => {
    const { dsymScript } = runPluginWithPhases({
      dsymShellScript: `# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.
export PROJECT_ROOT="$PROJECT_DIR"/..
${EXPECTED_PATH_EXPORT}
PODS_SCRIPT="\${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"
SPM_SCRIPT="\${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"
if [ -f "$PODS_SCRIPT" ]; then
  if ! /bin/sh "$PODS_SCRIPT"; then
    echo "warning: PostHog dSYM upload failed; continuing archive. Native crash symbolication may be incomplete."
  fi
elif [ -f "$SPM_SCRIPT" ]; then
  if ! /bin/sh "$SPM_SCRIPT"; then
    echo "warning: PostHog dSYM upload failed; continuing archive. Native crash symbolication may be incomplete."
  fi
fi
`,
    });

    expect(dsymScript).not.toContain('if ! if !');
    expect(dsymScript.match(/PostHog dSYM upload failed/g)).toHaveLength(2);
  });

  it('looks up the generated dSYM upload phase by Xcode comment and type', () => {
    runPluginWithPhases();

    expect(mockProject.pbxItemByComment).toHaveBeenCalledWith(
      DSYM_UPLOAD_PHASE_NAME,
      PHASE_TYPE
    );
  });

  it('registers a finalized iOS patch for prebuild-created PostHog phases', () => {
    runPluginWithPhases();

    expect(mockFinalizedModCalls).toHaveLength(1);
    expect(mockFinalizedModCalls[0].platform).toBe('ios');
    expect(mockFinalizedModCalls[0].action).toEqual(expect.any(Function));
  });

  it('executes the finalized iOS patch against the generated Xcode project', () => {
    const generatedProject = {
      parseSync: jest.fn(),
      pbxItemByComment: jest.fn(() => undefined),
      writeSync: jest.fn(() => 'patched project'),
    };
    const writeFileSyncSpy = jest
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined);

    IOSConfig.Paths.getPBXProjectPath.mockReturnValue(
      '/repo/ios/Ogabassey.xcodeproj/project.pbxproj'
    );
    IOSConfig.XcodeUtils.getPbxproj.mockReturnValue(generatedProject);

    runPluginWithPhases();

    expect(() =>
      mockFinalizedModCalls[0].action({
        modRequest: { projectRoot: '/repo' },
      })
    ).not.toThrow();
    expect(generatedProject.parseSync).toHaveBeenCalled();
    expect(generatedProject.writeSync).toHaveBeenCalled();
    expect(writeFileSyncSpy).toHaveBeenCalledWith(
      '/repo/ios/Ogabassey.xcodeproj/project.pbxproj',
      'patched project'
    );
  });
});
