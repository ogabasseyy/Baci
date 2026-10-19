type PrerenderDeploymentSignals = {
  vercelEnv: string | undefined;
};

function readPrerenderDeploymentSignals(): PrerenderDeploymentSignals {
  return { vercelEnv: process.env.VERCEL_ENV };
}

/**
 * Whether this build may prerender a reduced static-param set.
 *
 * Branch previews upload every build file cold (preview deployments share no
 * file hashes with production), and the full ~183k-file output never finishes
 * the platform finalize step (`BUILD_FAILED` / `BUILD_EXCEEDED_MAXIMUM_TIME`
 * after 15–45 minutes, versus ~86s for production's warm ~81k-file delta).
 * Capping the large catalog enumerators for preview-target builds keeps the
 * preview output small enough to deploy while leaving production untouched.
 *
 * Fail-closed by exact match: only `VERCEL_ENV=preview` (set by
 * `vercel build` without `--prod`) caps. Production, development, test, and
 * unset all yield the full set — a miscased or missing value must never
 * silently shrink production's SEO-load-bearing prerender coverage.
 */
export function isPreviewPrerenderBuild(
  signals: PrerenderDeploymentSignals = readPrerenderDeploymentSignals()
): boolean {
  return signals.vercelEnv?.trim() === 'preview';
}
