import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Phase0BenchmarkReport,
  runPhase0Benchmarks,
} from './run-phase0-benchmarks';

export function formatPhase0MarkdownReport(
  report: Phase0BenchmarkReport
): string {
  const { compiler, workerdSsr, generationChurn } = report;
  const routeRows = workerdSsr.routes
    .map(
      (r) =>
        `| \`${r.route}\` | \`${r.expectedStatus}\` | ${r.coldWallMs} ms | ${r.warmP50WallMs} ms | ${r.warmP95WallMs} ms | ${r.warmP50IsolateSsrMs} ms | ${r.warmP95IsolateSsrMs} ms | ${(r.htmlBytes / 1024).toFixed(1)} KiB |`
    )
    .join('\n');

  const churnRows = generationChurn
    .map(
      (c) =>
        `| ${c.inventoryWritesPerMinute}/min | \`${c.strategy}\` | ${c.catalogCacheHitRatio}% | ${c.originCatalogRpcCalls} | ${c.originAvailabilityRpcCalls} | ${c.originGenerationReads} |`
    )
    .join('\n');

  return [
    '# Phase 0 Storefront Compiler & Edge Data-Plane Benchmark Report',
    '',
    `- **Catalog Scale:** ${report.catalogProductCount} products (Ogabassey multi-variant fixture)`,
    `- **Compile Cold / Warm p50 / Warm p95:** ${compiler.coldCompileMs} ms / ${compiler.warmP50CompileMs} ms / ${compiler.warmP95CompileMs} ms`,
    `- **Derived Hard SIGKILL Timeout (\`max(5 * p95, 5000ms)\`):** ${compiler.derivedSigkillTimeoutMs} ms`,
    `- **Worker SSR Bundle (\`worker.mjs\`):** ${(compiler.workerRawBytes / 1024).toFixed(1)} KiB raw / ${(compiler.workerGzipBytes / 1024).toFixed(1)} KiB gzip`,
    `- **Client Hydration Bundle (\`client.js\`):** ${(compiler.clientRawBytes / 1024).toFixed(1)} KiB raw / ${(compiler.clientGzipBytes / 1024).toFixed(1)} KiB gzip (budget <= 150 KiB)`,
    `- **Tailwind v4 CSS Bundle (\`styles.css\`):** ${(compiler.cssRawBytes / 1024).toFixed(1)} KiB raw / ${(compiler.cssGzipBytes / 1024).toFixed(1)} KiB gzip (budget <= 50 KiB)`,
    `- **Security Proofs:** True-404=${workerdSsr.true404Verified}, AnonCostPriceContained=${workerdSsr.anonCostPriceContained}, SpoofedTenantBlocked=${workerdSsr.spoofedTenantBlocked}`,
    '',
    '## `workerd` (Miniflare) Edge SSR + Outbound Latency',
    '',
    '| Route | Status | Cold Wall | Warm p50 Wall | Warm p95 Wall | Isolate SSR p50 | Isolate SSR p95 | HTML Size |',
    '|---|---|---|---|---|---|---|---|',
    routeRows,
    '',
    '## Generation-Churn Write-Load Simulation (1,800 req / 180s across 96 Listing+PDP URLs)',
    '',
    '| Inventory Writes | Strategy | Catalog Cache Hit Ratio | Full Catalog RPCs | Lightweight Availability RPCs | Generation Samples |',
    '|---|---|---|---|---|---|',
    churnRows,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const report = await runPhase0Benchmarks();
  process.stdout.write(`${formatPhase0MarkdownReport(report)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
