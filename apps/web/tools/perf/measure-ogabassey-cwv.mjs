#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ogabasseyCwvEnv } from './measure-ogabassey-cwv-env-utils.mjs';
import { ogabasseyCwvNetwork } from './measure-ogabassey-cwv-network-utils.mjs';
import { ogabasseyCwvRuntimeConfig } from './measure-ogabassey-cwv-runtime-config.mjs';
import { ogabasseyCwvSummary } from './measure-ogabassey-cwv-summary-utils.mjs';
import { ogabasseyCwvUtils } from './measure-ogabassey-cwv-utils.mjs';

const { isFalseyEnvValue, isTruthyEnvValue, loadOgaBasseyCwvEnvFiles } =
  ogabasseyCwvEnv;
const { resolveCanonicalUrlOrFailure, resolveLatestBlogPostUrl } =
  ogabasseyCwvNetwork;
const { buildRunConfig } = ogabasseyCwvRuntimeConfig;
const { printCwvSummaryTable } = ogabasseyCwvSummary;
const {
  applyPdpCanonicalResolution,
  buildLegacyPdpLcpJson,
  buildOgaBasseyCwvConfigurationFailures,
  buildOgaBasseyCwvTargets,
  DEFAULT_OGABASSEY_CWV_TARGETS,
  filterOgaBasseyCwvTargets,
  logOgaBasseyCwvCompletion,
} = ogabasseyCwvUtils;

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
export async function runOgaBasseyCwv() {
  await loadOgaBasseyCwvEnvFiles({ appRoot, repoRoot });
  const auditId = new Date().toISOString().replace(/[:.]/g, '-');
  const {
    artifactFileName,
    debugBearApiKey,
    debugBearDevice,
    debugBearProjectId,
    debugBearRegion,
    debugBearRequiresConfiguredDeviceUserAgent,
    debugBearRunner,
    hasConfiguredDebugBearDeviceUserAgent,
    hasDiscoverableDebugBearProject,
    isDebugBearDisabled,
    isDebugBearExplicitlyEnabled,
    outputDir,
    runPsi,
    shouldAttemptDebugBear,
    shouldIncludeLatestBlogPostTarget,
    shouldRunDebugBear,
    shouldRunExternalProbes,
    shouldRunPsi,
    strategies,
    targetLabelFilter,
  } = buildRunConfig({ auditId, repoRoot });
  await mkdir(outputDir, { recursive: true });
  async function writeArtifact(name, payload) {
    await writeFile(
      join(outputDir, artifactFileName(name)),
      JSON.stringify(payload, null, 2)
    );
  }
  const skipLatestBlogPostTarget = isTruthyEnvValue(
    process.env.OGABASSEY_CWV_SKIP_LATEST_BLOG_POST
  );
  const explicitBlogPostUrl = process.env.OGABASSEY_BLOG_POST_URL?.trim() || '';
  const shouldResolveLatestBlogPost =
    shouldRunExternalProbes &&
    shouldIncludeLatestBlogPostTarget &&
    !skipLatestBlogPostTarget &&
    !explicitBlogPostUrl;
  const blogPostUrl = skipLatestBlogPostTarget
    ? null
    : explicitBlogPostUrl ||
      (shouldResolveLatestBlogPost
        ? await resolveLatestBlogPostUrl(
            process.env.OGABASSEY_BLOG_URL?.trim() ||
              DEFAULT_OGABASSEY_CWV_TARGETS.blog
          )
        : null);
  const targetResolutionFailures =
    shouldResolveLatestBlogPost && !blogPostUrl
      ? [
          {
            label: 'blog-post-latest',
            message:
              'Could not resolve the latest blog post URL. Set OGABASSEY_BLOG_POST_URL or OGABASSEY_CWV_SKIP_LATEST_BLOG_POST=1.',
            source: 'target-resolution',
          },
        ]
      : [];
  const shouldUsePdpLcpUrl = isTruthyEnvValue(
    process.env.OGABASSEY_CWV_USE_PDP_LCP_URL
  );
  const requestedPdpUrl =
    (shouldUsePdpLcpUrl ? process.env.OGABASSEY_PDP_LCP_URL?.trim() : '') ||
    process.env.OGABASSEY_PDP_URL?.trim() ||
    DEFAULT_OGABASSEY_CWV_TARGETS.pdp;
  const shouldResolvePdpCanonical = !isFalseyEnvValue(
    process.env.OGABASSEY_CWV_RESOLVE_PDP_CANONICAL
  );
  let targets = filterOgaBasseyCwvTargets(
    buildOgaBasseyCwvTargets({
      blogPostUrl,
      blogUrl: process.env.OGABASSEY_BLOG_URL,
      homeUrl: process.env.OGABASSEY_HOME_URL,
      pdpUrl: requestedPdpUrl,
    }),
    targetLabelFilter
  );
  const pdpTarget = targets.find((target) => target.label === 'pdp');
  if (pdpTarget && shouldRunExternalProbes && shouldResolvePdpCanonical) {
    const pdpResolution = await resolveCanonicalUrlOrFailure(requestedPdpUrl, {
      label: pdpTarget.label,
    });
    targets = applyPdpCanonicalResolution({
      pdpResolution,
      pdpTarget,
      targetResolutionFailures,
      targets,
    });
  }
  const summaries = [];
  const failures = buildOgaBasseyCwvConfigurationFailures({
    debugBearApiKey,
    debugBearRequiresConfiguredDeviceUserAgent,
    hasConfiguredDebugBearDeviceUserAgent,
    hasDiscoverableDebugBearProject,
    isDebugBearDisabled,
    isDebugBearExplicitlyEnabled,
    shouldAttemptDebugBear,
    shouldRunDebugBear,
    shouldRunPsi,
    targetResolutionFailures,
    targets,
  });
  const logProgress = (message) => console.error(`[ogabassey-cwv] ${message}`);
  if (shouldRunPsi) {
    for (const target of targets) {
      for (const strategy of strategies) {
        try {
          logProgress(`PSI ${strategy} ${target.label}`);
          const psi = await runPsi(target, strategy);
          const artifact = `${target.label}-${strategy}-psi.json`;
          await writeArtifact(artifact, psi.payload);
          summaries.push(psi.summary);
        } catch (error) {
          failures.push({
            label: target.label,
            message: error instanceof Error ? error.message : String(error),
            source: 'psi',
            strategy,
          });
        }
      }
    }
  }
  if (shouldRunDebugBear) {
    let projects = [];
    if (!debugBearProjectId) {
      try {
        logProgress('DebugBear projects');
        projects = await debugBearRunner.getProjects();
      } catch (error) {
        failures.push({
          label: 'projects',
          message: error instanceof Error ? error.message : String(error),
          source: 'debugbear',
        });
      }
    } else {
      logProgress(`DebugBear project ${debugBearProjectId}`);
    }
    if (!debugBearProjectId && projects.length === 0) {
      failures.push({
        label: 'projects',
        message:
          'DebugBear project discovery returned no projects. Set DEBUGBEAR_PROJECT_ID or use an admin key with project access.',
        source: 'debugbear',
      });
    }
    const debugBearTargets =
      debugBearProjectId || projects.length ? targets : [];
    for (const target of debugBearTargets) {
      try {
        logProgress(
          `DebugBear ${debugBearDevice}/${debugBearRegion} ${target.label}`
        );
        const debugBearResult = await debugBearRunner.run(target, projects);
        const artifact = `${target.label}-debugbear.json`;
        await writeArtifact(artifact, debugBearResult.payload);
        if (debugBearResult.summary) {
          summaries.push(debugBearResult.summary);
        }
        if (debugBearResult.failure) {
          failures.push({
            label: target.label,
            message: debugBearResult.failure,
            source: 'debugbear',
          });
        }
      } catch (error) {
        failures.push({
          label: target.label,
          message: error instanceof Error ? error.message : String(error),
          source: 'debugbear',
        });
      }
    }
  }
  if (summaries.length === 0) {
    failures.push({
      label: 'measurement',
      message: 'No CWV measurement summaries were produced.',
      source: 'configuration',
    });
  }
  await writeArtifact('summary.json', {
    auditId,
    createdAt: new Date().toISOString(),
    failures,
    summaries,
    targets,
  });
  const shouldPrintLegacyPdpJson = isTruthyEnvValue(
    process.env.OGABASSEY_CWV_LEGACY_PDP_LCP_JSON
  );
  const shouldPrintSummaryTable =
    !shouldPrintLegacyPdpJson &&
    !isFalseyEnvValue(process.env.OGABASSEY_CWV_SUMMARY_TABLE);

  if (shouldPrintSummaryTable) {
    printCwvSummaryTable(summaries);
  }
  if (failures.length) {
    console.error('Failures:');
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }

  if (shouldPrintLegacyPdpJson) {
    const summary =
      summaries.find((row) => row.label === 'pdp') ?? summaries[0];
    if (summary) {
      console.log(JSON.stringify(buildLegacyPdpLcpJson(summary)));
    }
  }
  logOgaBasseyCwvCompletion(auditId, outputDir, shouldPrintLegacyPdpJson);
}
if (import.meta.main) await runOgaBasseyCwv();
