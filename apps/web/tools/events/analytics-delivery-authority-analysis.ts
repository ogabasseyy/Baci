import { analyzeRouteConstruction } from './analytics-delivery-authority-call-analysis';
import { analyticsDeliveryAuthorityManifest as manifest } from './analytics-delivery-authority-manifest';
import { analyticsDeliveryAuthoritySourceGuards as sourceGuards } from './analytics-delivery-authority-source-guards';
import { configLoadCount } from './analytics-delivery-config-load-count';
import { analyticsDeliveryModuleGraph as moduleGraph } from './analytics-delivery-module-graph';
import { isTestSourcePath } from './event-pipeline-source-path';

const wrapperSpecifier = '@/lib/analytics/trusted-server-ad-platform-fanout';
const configPath =
  'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts';
const forbiddenPureSpecifier =
  /(?:@supabase\/supabase-js|^next(?:\/|$)|\/supabase\/|@\/env$)/;

function configImportSpecifiers(
  path: string,
  source: string,
  sources: ReadonlyMap<string, string>
): string[] {
  const target = new Set([configPath]);
  return moduleGraph.moduleReferences(path, source).filter((specifier) => {
    const resolved = moduleGraph.resolveLocalModule(path, specifier, sources);
    return Boolean(
      resolved && moduleGraph.importPath(resolved, target, sources)
    );
  });
}

// biome-ignore format: compact aggregate verifier stays within the 300-line runtime gate.
export function analyzeAnalyticsDeliveryAuthoritySources(sources: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [];
  const add = (path: string, message: string) => findings.push(`${path}: ${message}`);
  const importers = [...sources].filter(([path, source]) => !isTestSourcePath(path) && moduleGraph.moduleReferences(path, source).some((specifier) => specifier === wrapperSpecifier || moduleGraph.resolveLocalModule(path, specifier, sources) === manifest.trustedWrapper)).map(([path]) => path).sort();
  const expected = [...manifest.trustedWrapperImporters].sort();
  for (const path of importers) if (!expected.includes(path as (typeof expected)[number])) add(path, 'unauthorized trusted wrapper importer');
  for (const path of expected) {
    const source = sources.get(path);
    if (!source) continue;
    if (!importers.includes(path)) add(path, 'missing direct trusted wrapper import');
    findings.push(...analyzeRouteConstruction(path, source));
  }

  const platformImporters = [...sources].filter(([path, source]) => !isTestSourcePath(path) && moduleGraph.moduleReferences(path, source).some((specifier) => moduleGraph.resolveLocalModule(path, specifier, sources) === manifest.retiredPlatformAuthority.helper || /(?:^|\/)platform-event-forwarding(?:\.[^/]*)?$/.test(specifier))).map(([path]) => path);
  for (const path of platformImporters) add(path, 'retired platform authority helper importer');
  if (sources.has(manifest.retiredPlatformAuthority.helper)) add(manifest.retiredPlatformAuthority.helper, 'retired platform authority helper is present');

  const wrapperSource = sources.get(manifest.trustedWrapper) ?? '';
  if (wrapperSource && !/^import ['"]server-only['"];?/m.test(wrapperSource)) add(manifest.trustedWrapper, 'trusted wrapper must import server-only');
  for (const path of [manifest.trustedWrapper, 'apps/web/src/lib/events/analytics-destination-adapter.ts']) {
    const source = sources.get(path);
    if (!source) continue;
    const configSpecifiers = configImportSpecifiers(path, source, sources);
    const reads = configLoadCount(path, source, configSpecifiers);
    if (reads !== 1) add(path, `configuration load count is ${reads}, expected 1`);
  }

  const pureClosure = moduleGraph.importClosure(manifest.pureFanoutRoots, sources);
  for (const path of pureClosure) {
    const source = sources.get(path) ?? '';
    for (const specifier of moduleGraph.moduleReferences(path, source)) if (forbiddenPureSpecifier.test(specifier)) add(path, `pure provider closure reaches forbidden import ${specifier}`);
    if (sourceGuards.readsCredentialEnvironment(path, source)) add(path, 'pure provider closure reads environment credentials');
    const configSpecifiers = configImportSpecifiers(path, source, sources);
    if (configLoadCount(path, source, configSpecifiers) > 0) add(path, 'pure provider closure reloads configuration');
  }

  const pureAuthorityClosure = [...pureClosure].filter((path) =>
    path.startsWith('apps/web/src/lib/analytics/')
  );
  const analyticsSensitive = new Set([
    manifest.trustedWrapper,
    configPath,
    ...pureAuthorityClosure,
    'apps/web/src/lib/facebook-capi.ts',
    'apps/web/src/lib/facebook-capi-request.ts',
    'apps/web/src/lib/ga4-measurement-protocol.ts',
    'apps/web/src/lib/snapchat-capi.ts',
    'apps/web/src/lib/tiktok-events-api.ts',
    'apps/web/src/lib/tiktok-events-api-request.ts',
  ]);
  const factorySensitive = new Set([
    'apps/web/src/lib/supabase/admin.ts',
    'apps/web/src/lib/supabase/service.ts',
  ]);
  for (const [path, source] of sources) {
    if (!sourceGuards.hasLeadingDirective(path, source, 'use client')) continue;
    const authorityPath =
      moduleGraph.importPath(path, analyticsSensitive, sources) ??
      moduleGraph.importPath(path, factorySensitive, sources);
    if (authorityPath) add(path, `client graph reaches privileged analytics authority: ${authorityPath.join(' -> ')}`);
  }
  return [...new Set(findings)].sort();
}
