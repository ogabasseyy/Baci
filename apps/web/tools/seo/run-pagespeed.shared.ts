import { DEFAULT_PAGE_SPEED_ROUTES } from './run-pagespeed.config';
import type {
  PageSpeedAuditResult,
  PageSpeedStrategy,
  PageSpeedTarget,
} from './run-pagespeed.types';
import { seoShared } from './shared';

function buildPageSpeedTargets({
  baseUrl,
  extraUrls,
}: {
  baseUrl: string;
  extraUrls: string[];
}): PageSpeedTarget[] {
  const normalizedBaseUrl = seoShared.normalizeOrigin(baseUrl);
  const defaults = DEFAULT_PAGE_SPEED_ROUTES.map((route) => ({
    label: route.label,
    url: seoShared.resolveUrl(normalizedBaseUrl, route.path),
  }));
  const extras = extraUrls.map((url, index) => ({
    label: `extra-${index + 1}`,
    url: parseHttpUrl(url),
  }));

  return dedupeTargets([...defaults, ...extras]);
}

function parseStrategies(value?: string): PageSpeedStrategy[] {
  const entries =
    value
      ?.split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (entries.length === 0) {
    return ['mobile'];
  }

  const invalidEntries = [...new Set(entries)].filter(
    (entry) => entry !== 'mobile' && entry !== 'desktop'
  );

  if (invalidEntries.length > 0) {
    throw new Error(
      `Invalid PageSpeed strategies: ${invalidEntries.join(', ')}. Allowed values: mobile, desktop`
    );
  }

  return [...new Set(entries as PageSpeedStrategy[])];
}

function buildPsiUrl({
  apiKey,
  strategy,
  targetUrl,
}: {
  apiKey?: string;
  strategy: PageSpeedStrategy;
  targetUrl: string;
}): string {
  const url = new URL(
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
  );
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('strategy', strategy);

  for (const category of [
    'performance',
    'accessibility',
    'best-practices',
    'seo',
  ]) {
    url.searchParams.append('category', category);
  }

  if (apiKey) {
    url.searchParams.set('key', apiKey);
  }

  return url.toString();
}

function buildPageSpeedSummary(results: PageSpeedAuditResult[]): string {
  const lines = [
    '## PageSpeed Insights',
    '',
    '| Target | Strategy | Status | Performance | LCP | CLS | TBT | INP |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const result of results) {
    lines.push(
      `| [${result.label}](${result.url}) | ${result.strategy} | ${
        result.passed ? 'PASS' : 'FAIL'
      } | ${formatScore(result.scores.performance)} | ${formatMilliseconds(
        result.vitals.lcp
      )} | ${formatCls(result.vitals.cls)} | ${formatMilliseconds(
        result.vitals.tbt
      )} | ${formatMilliseconds(result.vitals.inp)} |`
    );
  }

  const failedResults = results.filter((result) => !result.passed);

  if (failedResults.length > 0) {
    lines.push('', '### Failures');

    for (const result of failedResults) {
      lines.push(`- ${result.label} (${result.strategy})`);
      for (const failure of result.failures) {
        lines.push(
          failure.message
            ? `  - ${failure.metric}: ${failure.message}`
            : `  - ${failure.metric}: ${
                failure.actual === null ? 'missing' : String(failure.actual)
              } (threshold ${failure.threshold})`
        );
      }
    }
  }

  const resultsWithLcpDiag = results.filter((r) =>
    Boolean(r.lcpDiagnostics?.lcpElement)
  );
  if (resultsWithLcpDiag.length > 0) {
    lines.push('', '### LCP Diagnostics');
    for (const result of resultsWithLcpDiag) {
      const d = result.lcpDiagnostics;
      if (!d) continue;
      lines.push(
        `- ${result.label} (${result.strategy}): element \`${d.lcpElement}\`, origin \`${d.lcpResourceOrigin ?? 'text'}\`, pre-LCP ${d.preLcpRequestCount ?? 'n/a'} reqs (${d.preLcpBytes ?? 'n/a'} B)`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number'
    ? String(Math.round(value * 100))
    : 'missing';
}

function formatMilliseconds(value: number | null | undefined): string {
  return typeof value === 'number' ? `${Math.round(value)} ms` : 'missing';
}

function formatCls(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(3) : 'missing';
}

function parseHttpUrl(value: string): string {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`unsupported protocol ${parsed.protocol}`);
    }

    return parsed.toString();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid PageSpeed target URL "${value}": ${reason}`);
  }
}

function dedupeTargets(targets: PageSpeedTarget[]): PageSpeedTarget[] {
  const seen = new Set<string>();

  return targets.filter((target) => {
    if (seen.has(target.url)) {
      return false;
    }

    seen.add(target.url);
    return true;
  });
}

export const pageSpeedShared = {
  buildPageSpeedSummary,
  buildPageSpeedTargets,
  buildPsiUrl,
  parseStrategies,
} as const;
