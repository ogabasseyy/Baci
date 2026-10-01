import { eventPipelineBoundaryManifest as manifest } from '../../src/lib/events/event-pipeline-boundary-manifest';
import { analyticsDeliveryModuleGraph as moduleGraph } from './analytics-delivery-module-graph';
import { eventPipelineCredentialImportAnalysis as credentialImports } from './event-pipeline-credential-import-analysis';
import { eventPipelineProductionSurface } from './event-pipeline-production-surface';
import { serviceRoleCredentialAuthority } from './event-pipeline-service-role-credential-analysis';
import { isTestSourcePath } from './event-pipeline-source-path';
import { eventPipelineStaticModuleGraph as staticGraph } from './event-pipeline-static-module-graph';

type FactoryKind = 'admin' | 'sdk' | 'service';
type AuthorityKind = FactoryKind | 'credential';
type AuthorityEdge = { key: string; message: string; path: string };

const factoryTargets = new Map<string, FactoryKind>([
  ['apps/web/src/lib/supabase/admin.ts', 'admin'],
  ['apps/web/src/lib/supabase/service.ts', 'service'],
]);

function factoryReference(
  importer: string,
  specifier: string,
  sources: ReadonlyMap<string, string>
): { kind: FactoryKind; target: string } | undefined {
  if (moduleGraph.isSupabaseSdkSpecifier(specifier)) {
    return { kind: 'sdk', target: '@supabase/supabase-js' };
  }
  const target = moduleGraph.resolveLocalModule(importer, specifier, sources);
  const kind = target ? factoryTargets.get(target) : undefined;
  return target && kind ? { kind, target } : undefined;
}

function allowedFactoryImporter(path: string, kind: FactoryKind): boolean {
  const authority = manifest.authority;
  const allowed: readonly string[] =
    kind === 'sdk'
      ? [...authority.factoryModules, ...authority.legacySdkImporters]
      : [
          ...authority[`${kind}Importers`],
          ...(kind === 'service' ? authority.operationalServiceImporters : []),
        ];
  return allowed.includes(path);
}

function allowsCredentialPath(path: readonly string[]): boolean {
  const allowed: readonly (readonly string[])[] =
    manifest.authority.credentialPaths;
  return allowed.some(
    (candidate) =>
      candidate.length === path.length &&
      candidate.every((segment, index) => segment === path[index])
  );
}

function allowsServicePath(path: readonly string[]): boolean {
  return manifest.authority.servicePaths.some(
    (candidate) =>
      candidate.length === path.length &&
      candidate.every((segment, index) => segment === path[index])
  );
}

function pathMessage(
  root: string,
  kind: AuthorityKind,
  target: string,
  path: readonly string[]
): string {
  const apiRoute =
    /^apps\/web\/src\/app\/api\/(?:.+\/)?route\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(
      root
    );
  const detail = path.length > 2 ? ` via ${path.join(' -> ')}` : '';
  return `${root}: ${apiRoute ? 'API' : 'production surface'} import graph reaches ${kind} authority ${target}${detail}`;
}

function collectAuthorityEdges(
  sources: ReadonlyMap<string, string>,
  roots: readonly string[],
  scanAllDirect: boolean
): AuthorityEdge[] {
  const graphSources = sources;
  const graph = staticGraph.create(graphSources);
  const approved = new Set<string>(manifest.trustedWrapperImporters);
  const indirectServiceTargets = manifest.authority.serviceImporters.filter(
    (path) => !approved.has(path)
  );
  const productionReachable = new Set<string>();
  const independentRoots = new Set<string>();
  for (const root of roots) {
    const source = sources.get(root);
    if (
      !source ||
      !eventPipelineProductionSurface.isIndependent(root, source)
    ) {
      continue;
    }
    independentRoots.add(root);
    for (const reachable of graph.importClosure([root])) {
      productionReachable.add(reachable);
    }
  }
  const directPaths = new Set([
    ...(scanAllDirect ? [...sources.keys()] : roots).filter(
      (path) => !isTestSourcePath(path)
    ),
    ...productionReachable,
  ]);
  const edges: AuthorityEdge[] = [];
  for (const path of directPaths) {
    const source = graphSources.get(path);
    if (!source) continue;
    const credentialFinding = serviceRoleCredentialFinding(path, source);
    if (credentialFinding) {
      edges.push({
        key: JSON.stringify(['direct', path, 'credential']),
        message: credentialFinding,
        path,
      });
    }
    for (const specifier of graph.moduleReferences(path)) {
      const reference = factoryReference(path, specifier, graphSources);
      if (
        !reference ||
        (reference.kind === 'sdk' &&
          !serviceRoleCredentialAuthority.readsCredential(path, source)) ||
        allowedFactoryImporter(path, reference.kind)
      ) {
        continue;
      }
      edges.push({
        key: JSON.stringify(['direct', path, reference.kind, reference.target]),
        message: `${path}: unauthorized ${reference.kind} factory importer`,
        path,
      });
    }
  }
  const credentialTargets = [...sources]
    .filter(
      ([path, source]) =>
        !factoryTargets.has(path) &&
        serviceRoleCredentialAuthority.readsCredential(path, source)
    )
    .map(([path]) => ({ kind: 'credential' as const, target: path }));
  const authorityTargets: {
    factory?: boolean;
    kind: AuthorityKind;
    productionOnly?: boolean;
    target: string;
  }[] = [
    ...[...factoryTargets].map(([target, kind]) => ({
      factory: true,
      kind,
      target,
    })),
    ...indirectServiceTargets.map((target) => ({
      kind: 'service' as const,
      productionOnly: true,
      target,
    })),
    ...credentialTargets,
  ];
  const authorityTargetPaths = new Set(
    authorityTargets.map(({ target }) => target)
  );
  const pathRoots = scanAllDirect ? roots : [...independentRoots];
  for (const root of pathRoots) {
    const source = sources.get(root);
    if (!source || isTestSourcePath(root)) continue;
    const paths = graph.importTargetPaths(root, authorityTargetPaths);
    for (const { factory, kind, productionOnly, target } of authorityTargets) {
      if (productionOnly && !independentRoots.has(root)) continue;
      if (factory && allowedFactoryImporter(root, kind as FactoryKind))
        continue;
      for (const path of paths.get(target) ?? []) {
        if (path.length < 2 || (factory && path.length === 2)) continue;
        if (kind === 'service' && allowsServicePath(path)) continue;
        if (
          factory &&
          path
            .slice(1, -1)
            .some((importer) =>
              allowedFactoryImporter(importer, kind as FactoryKind)
            )
        ) {
          continue;
        }
        if (
          kind === 'credential' &&
          !credentialImports.edgeIsRelevant(path.at(-2) ?? '', target, sources)
        ) {
          continue;
        }
        if (kind === 'credential' && allowsCredentialPath(path)) continue;
        const message = pathMessage(root, kind, target, path);
        for (let index = 1; index < path.length; index += 1) {
          edges.push({
            key: JSON.stringify([
              'path',
              root,
              path[index - 1],
              path[index],
              kind,
            ]),
            message,
            path: path[index - 1] ?? root,
          });
        }
      }
    }
  }
  return edges;
}

export function serviceAuthorityGraphFindings(
  sources: ReadonlyMap<string, string>,
  roots: readonly string[] = [...sources.keys()],
  frozenSources?: ReadonlyMap<string, string>,
  freezeInheritedPaths: ReadonlySet<string> = new Set(),
  authorityByteSources?: ReadonlyMap<string, string>
): string[] {
  const scanAllDirect = Boolean(frozenSources);
  const frozenEdges = frozenSources
    ? collectAuthorityEdges(frozenSources, roots, scanAllDirect)
    : [];
  const inherited = new Set(frozenEdges.map(({ key }) => key));
  const findings = collectAuthorityEdges(sources, roots, scanAllDirect)
    .filter(({ key }) => !inherited.has(key))
    .map(({ message }) => message);
  if (freezeInheritedPaths.size > 0 && !authorityByteSources) {
    findings.push(
      'event-pipeline: authority-byte baseline is required for inherited path freezing'
    );
  }
  if (authorityByteSources) {
    for (const path of new Set(frozenEdges.map((edge) => edge.path))) {
      if (
        freezeInheritedPaths.has(path) &&
        sources.get(path) !== authorityByteSources.get(path)
      ) {
        findings.push(
          `${path}: inherited event-pipeline authority source bytes changed`
        );
      }
    }
  }
  return [...new Set(findings)];
}

export function serviceRoleCredentialFinding(
  path: string,
  source: string
): string | undefined {
  const recorded = Object.values(serviceRoleCredentialAuthority.ledgers).some(
    (ledger) => Object.hasOwn(ledger, path)
  );
  return serviceRoleCredentialAuthority.readsCredential(path, source) &&
    !recorded
    ? `${path}: service-role credential read is forbidden`
    : undefined;
}
