import { join } from 'node:path';
import { ogabasseyCwvEnv } from './measure-ogabassey-cwv-env-utils.mjs';
import { ogabasseyCwvRunners } from './measure-ogabassey-cwv-runners.mjs';

const { isFalseyEnvValue, isTruthyEnvValue, normalizeEnvFlag } =
  ogabasseyCwvEnv;
const { createDebugBearRunner, createPsiRunner } = ogabasseyCwvRunners;

function buildRunConfig({ auditId, repoRoot }) {
  const useDebugBearRawDir = isTruthyEnvValue(
    process.env.OGABASSEY_CWV_USE_DEBUGBEAR_RAW_DIR
  );
  const customOutputDir =
    process.env.OGABASSEY_AUDIT_OUTPUT_DIR?.trim() ||
    (useDebugBearRawDir ? process.env.DEBUGBEAR_RAW_DIR?.trim() : '') ||
    process.env.OGABASSEY_CWV_DEFAULT_OUTPUT_DIR?.trim() ||
    '';
  const outputDir =
    customOutputDir ||
    join(repoRoot, 'output/audits', `ogabassey-cwv-${auditId}`);
  const artifactFileName = (name) =>
    customOutputDir && name !== 'summary.json' ? `${auditId}-${name}` : name;
  const psiApiKey =
    process.env.PAGESPEED_INSIGHTS_API_KEY || process.env.PSI_API_KEY || '';
  const debugBearProjectId = process.env.DEBUGBEAR_PROJECT_ID?.trim() || '';
  const debugBearProjectApiKey = process.env.DEBUGBEAR_API_KEY?.trim() || '';
  const debugBearAdminApiKey =
    process.env.DEBUGBEAR_ADMIN_API_KEY?.trim() || '';
  const debugBearSetting = normalizeEnvFlag(
    process.env.OGABASSEY_CWV_DEBUGBEAR
  );
  const isDebugBearExplicitlyEnabled = isTruthyEnvValue(debugBearSetting);
  const isDebugBearDisabled = isFalseyEnvValue(debugBearSetting);
  const debugBearDiscoveryApiKey =
    debugBearAdminApiKey ||
    (!debugBearProjectId && isDebugBearExplicitlyEnabled
      ? debugBearProjectApiKey
      : '');
  const debugBearApiKey = debugBearProjectId
    ? debugBearProjectApiKey || debugBearAdminApiKey
    : debugBearDiscoveryApiKey;
  const debugBearDeviceOverride = process.env.DEBUGBEAR_DEVICE?.trim() || '';
  const debugBearDevice = debugBearDeviceOverride || 'Mobile';
  const debugBearRequiresConfiguredDeviceUserAgent = !isFalseyEnvValue(
    process.env.OGABASSEY_CWV_REQUIRE_DEBUGBEAR_DEVICE_UA
  );
  const hasConfiguredDebugBearDeviceUserAgent = Boolean(
    debugBearDeviceOverride
  );
  const debugBearRegion = process.env.DEBUGBEAR_REGION || 'us-east';
  const debugBearMaxPollAttempts =
    Number(process.env.DEBUGBEAR_MAX_POLL_ATTEMPTS) || 90;
  const debugBearPollIntervalMs =
    Number(process.env.DEBUGBEAR_POLL_INTERVAL_MS) || 5000;
  const hasDiscoverableDebugBearProject = Boolean(
    debugBearProjectId || debugBearDiscoveryApiKey
  );
  const shouldAttemptDebugBear =
    isDebugBearExplicitlyEnabled ||
    Boolean(debugBearProjectId || debugBearAdminApiKey);
  const canRunDebugBearWithStableUserAgent =
    !debugBearRequiresConfiguredDeviceUserAgent ||
    hasConfiguredDebugBearDeviceUserAgent;
  const shouldRunDebugBear =
    !isDebugBearDisabled &&
    shouldAttemptDebugBear &&
    Boolean(debugBearApiKey) &&
    hasDiscoverableDebugBearProject &&
    canRunDebugBearWithStableUserAgent;
  const shouldRunPsi = !isFalseyEnvValue(process.env.OGABASSEY_CWV_PSI);
  const targetLabelFilter = process.env.OGABASSEY_CWV_TARGET_LABELS || '';
  const requestedTargetLabels = targetLabelFilter
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  const shouldIncludeLatestBlogPostTarget =
    requestedTargetLabels.length === 0 ||
    requestedTargetLabels.some((label) =>
      ['blog-post-latest', 'latest-blog-post'].includes(label)
    );
  const strategies = (process.env.OGABASSEY_CWV_STRATEGIES || 'mobile,desktop')
    .split(',')
    .map((strategy) => strategy.trim())
    .filter(Boolean);

  return {
    artifactFileName,
    debugBearApiKey,
    debugBearDevice,
    debugBearProjectId,
    debugBearRegion,
    debugBearRequiresConfiguredDeviceUserAgent,
    debugBearRunner: createDebugBearRunner({
      adminApiKey: debugBearDiscoveryApiKey,
      apiKey: debugBearApiKey,
      device: debugBearDevice,
      maxPollAttempts: debugBearMaxPollAttempts,
      pollIntervalMs: debugBearPollIntervalMs,
      projectId: debugBearProjectId,
      region: debugBearRegion,
    }),
    hasConfiguredDebugBearDeviceUserAgent,
    hasDiscoverableDebugBearProject,
    isDebugBearDisabled,
    isDebugBearExplicitlyEnabled,
    outputDir,
    runPsi: createPsiRunner({ apiKey: psiApiKey }),
    shouldAttemptDebugBear,
    shouldIncludeLatestBlogPostTarget,
    shouldRunDebugBear,
    shouldRunExternalProbes: shouldRunPsi || shouldRunDebugBear,
    shouldRunPsi,
    strategies,
    targetLabelFilter,
  };
}

export const ogabasseyCwvRuntimeConfig = Object.freeze({ buildRunConfig });
