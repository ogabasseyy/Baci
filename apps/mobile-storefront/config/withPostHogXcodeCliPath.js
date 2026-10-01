const fs = require('node:fs');
const {
  IOSConfig,
  withFinalizedMod,
  withXcodeProject,
} = require('@expo/config-plugins');

const BUNDLE_PHASE_NAME = 'Bundle React Native code and images';
const DSYM_UPLOAD_PHASE_NAME = 'Upload PostHog Debug Symbols';
const XCODE_PHASE_TYPE = 'PBXShellScriptBuildPhase';
const POSTHOG_XCODE_SCRIPT = 'posthog-xcode.sh';
const POSTHOG_DSYM_UPLOAD_SCRIPT = 'upload-symbols.sh';
const PROJECT_ROOT_EXPORT = 'export PROJECT_ROOT="$PROJECT_DIR"/..';
const POSTHOG_CLI_PATH_EXPORT =
  'export PATH="$PROJECT_ROOT/node_modules/.bin:$PROJECT_ROOT/../../node_modules/.bin:$PATH"';
const LEGACY_APP_ONLY_PATH_EXPORT =
  'export PATH="$PROJECT_ROOT/node_modules/.bin:$PATH"';
const POSTHOG_SKIP_ON_CONFLICT_EXPORT = 'export POSTHOG_SKIP_ON_CONFLICT=1';
const POSTHOG_DSYM_UPLOAD_WARNING =
  'PostHog dSYM upload failed; continuing archive. Native crash symbolication may be incomplete.';
const POSTHOG_DSYM_BEST_EFFORT_MARKER =
  'PostHog dSYM upload is best-effort; never fail the app archive.';
const POSTHOG_DSYM_INPUT_PATH = `\${DWARF_DSYM_FOLDER_PATH}/\${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/\${PRODUCT_NAME}`;
const QUOTED_POSTHOG_DSYM_INPUT_PATH = `"${POSTHOG_DSYM_INPUT_PATH}"`;

function parseShellScript(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ensureProjectRootExport(script) {
  return /^export PROJECT_ROOT=.*$/m.test(script)
    ? script
    : `${PROJECT_ROOT_EXPORT}\n${script}`;
}

function patchPostHogCliPath(script, marker = POSTHOG_XCODE_SCRIPT) {
  if (!script.includes(marker)) {
    return script;
  }

  if (script.includes(POSTHOG_CLI_PATH_EXPORT)) {
    return ensureProjectRootExport(script);
  }

  if (script.includes(LEGACY_APP_ONLY_PATH_EXPORT)) {
    return ensureProjectRootExport(
      script.replace(LEGACY_APP_ONLY_PATH_EXPORT, POSTHOG_CLI_PATH_EXPORT)
    );
  }

  const projectRootMatch = script.match(/^export PROJECT_ROOT=.*$/m);
  if (!projectRootMatch || projectRootMatch.index === undefined) {
    return `${PROJECT_ROOT_EXPORT}\n${POSTHOG_CLI_PATH_EXPORT}\n${script}`;
  }

  const insertAt = projectRootMatch.index + projectRootMatch[0].length;
  return `${script.slice(0, insertAt)}\n${POSTHOG_CLI_PATH_EXPORT}${script.slice(insertAt)}`;
}

function patchPostHogHermesUploadConflictHandling(script) {
  if (!script.includes(POSTHOG_XCODE_SCRIPT)) {
    return script;
  }

  let conflictGuardSeen = false;
  return script
    .split('\n')
    .flatMap((line) => {
      if (line.includes(POSTHOG_SKIP_ON_CONFLICT_EXPORT)) {
        conflictGuardSeen = true;
      }
      if (line.includes(POSTHOG_XCODE_SCRIPT) && !conflictGuardSeen) {
        conflictGuardSeen = true;
        return [POSTHOG_SKIP_ON_CONFLICT_EXPORT, line];
      }
      return [line];
    })
    .join('\n');
}

function patchShellPhaseCliPath(phase, marker) {
  const shellScript = parseShellScript(phase?.shellScript);
  if (!shellScript) {
    return;
  }

  const withCliPath = patchPostHogCliPath(shellScript, marker);
  const patchedScript =
    marker === POSTHOG_XCODE_SCRIPT
      ? patchPostHogHermesUploadConflictHandling(withCliPath)
      : withCliPath;
  if (patchedScript !== shellScript) {
    phase.shellScript = JSON.stringify(patchedScript);
  }
}

function patchPostHogDsymUploadBestEffort(script) {
  if (!script.includes(POSTHOG_DSYM_UPLOAD_SCRIPT)) {
    return script;
  }

  let bestEffortScript = script;
  if (!bestEffortScript.includes(POSTHOG_DSYM_BEST_EFFORT_MARKER)) {
    const bestEffortHeader = `# ${POSTHOG_DSYM_BEST_EFFORT_MARKER}\nset +e`;
    bestEffortScript = bestEffortScript.startsWith('#!')
      ? bestEffortScript.replace(/\n/, `\n${bestEffortHeader}\n`)
      : `${bestEffortHeader}\n${bestEffortScript}`;
  }

  const wrapCommand = (line, command) => {
    if (line.trim() !== command) {
      return line;
    }

    const indent = line.match(/^\s*/)?.[0] ?? '';
    return `${indent}if ! ${command}; then
${indent}  echo "warning: ${POSTHOG_DSYM_UPLOAD_WARNING}"
${indent}fi`;
  };

  const wrappedScript = [
    '/bin/sh "$PODS_SCRIPT"',
    '/bin/sh "$SPM_SCRIPT"',
  ].reduce((patchedScript, command) => {
    return patchedScript
      .split('\n')
      .map((line) => wrapCommand(line, command))
      .join('\n');
  }, bestEffortScript);

  return /(?:^|\n)\s*exit 0\s*$/.test(wrappedScript.trimEnd())
    ? wrappedScript
    : `${wrappedScript.trimEnd()}\nexit 0\n`;
}

function patchDsymUploadPhaseScript(phase) {
  const shellScript = parseShellScript(phase?.shellScript);
  if (!shellScript) {
    return;
  }

  const withCliPath = patchPostHogCliPath(
    shellScript,
    POSTHOG_DSYM_UPLOAD_SCRIPT
  );
  const patchedScript = patchPostHogDsymUploadBestEffort(withCliPath);
  if (patchedScript !== shellScript) {
    phase.shellScript = JSON.stringify(patchedScript);
  }
}

function patchDsymUploadInputPath(phase) {
  if (!phase) {
    return;
  }

  const inputPaths = Array.isArray(phase.inputPaths) ? phase.inputPaths : [];
  if (
    inputPaths.includes(POSTHOG_DSYM_INPUT_PATH) ||
    inputPaths.includes(QUOTED_POSTHOG_DSYM_INPUT_PATH)
  ) {
    return;
  }

  phase.inputPaths = [...inputPaths, QUOTED_POSTHOG_DSYM_INPUT_PATH];
}

function patchPostHogXcodeProject(project) {
  const bundlePhase = project.pbxItemByComment(
    BUNDLE_PHASE_NAME,
    XCODE_PHASE_TYPE
  );
  const dsymUploadPhase = project.pbxItemByComment(
    DSYM_UPLOAD_PHASE_NAME,
    XCODE_PHASE_TYPE
  );

  if (bundlePhase) {
    patchShellPhaseCliPath(bundlePhase, POSTHOG_XCODE_SCRIPT);
  }

  if (dsymUploadPhase) {
    patchDsymUploadPhaseScript(dsymUploadPhase);
    patchDsymUploadInputPath(dsymUploadPhase);
  }
}

const withPostHogXcodeCliPath = (config) => {
  const configWithXcodePatch = withXcodeProject(config, (config) => {
    patchPostHogXcodeProject(config.modResults);
    return config;
  });

  return withFinalizedMod(configWithXcodePatch, [
    'ios',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const projectPath = IOSConfig.Paths.getPBXProjectPath(projectRoot);
      const project = IOSConfig.XcodeUtils.getPbxproj(projectRoot);

      if (typeof project.parseSync === 'function') {
        project.parseSync();
      }
      patchPostHogXcodeProject(project);
      fs.writeFileSync(projectPath, project.writeSync());

      return config;
    },
  ]);
};

module.exports = withPostHogXcodeCliPath;
