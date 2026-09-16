import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const authorizedImporters = [
  'app/api/integrations/ads/google/sync/route.ts',
  'app/api/integrations/ads/meta/sync/route.ts',
  'app/api/integrations/ads/snapchat/sync/route.ts',
  'app/api/integrations/ads/tiktok/sync/route.ts',
];

function isRpcWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function rpcCallTargets(source: string, rpcName: string): boolean {
  const callMarker = 'spendSupabase.rpc(';
  let searchFrom = 0;
  for (;;) {
    const callIndex = source.indexOf(callMarker, searchFrom);
    if (callIndex === -1) {
      return false;
    }
    let nameStart = callIndex + callMarker.length;
    while (isRpcWhitespace(source[nameStart])) {
      nameStart += 1;
    }
    const quote = source[nameStart];
    if (
      (quote === "'" || quote === '"') &&
      source.startsWith(rpcName, nameStart + 1) &&
      (source[nameStart + 1 + rpcName.length] === "'" ||
        source[nameStart + 1 + rpcName.length] === '"')
    ) {
      return true;
    }
    searchFrom = callIndex + 1;
  }
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

describe('Ads spend service-role boundary', () => {
  it('allows only the four authenticated sync routes to import the helper', () => {
    const importers = productionTypeScriptFiles(sourceRoot)
      .filter((path) =>
        readFileSync(path, 'utf8').includes(
          "from '@/lib/ads/server-spend-client'"
        )
      )
      .map((path) => relative(sourceRoot, path));

    expect(importers.sort()).toEqual(authorizedImporters.sort());
  });

  it.each([
    ['google-ads/sync.ts', 'replace_google_ads_spend_daily'],
    ['ads/meta/sync.ts', 'replace_merchant_ads_spend_daily_window'],
    ['ads/snapchat/sync.ts', 'replace_merchant_ads_spend_daily_window'],
    ['ads/tiktok/sync.ts', 'replace_merchant_ads_spend_daily_window'],
  ])('limits %s to one privileged replacement call', (path, rpcName) => {
    const source = readFileSync(resolve(sourceRoot, `lib/${path}`), 'utf8');

    expect(source.match(/spendSupabase\.rpc/g)).toHaveLength(1);
    expect(rpcCallTargets(source, rpcName)).toBe(true);
  });

  it('returns false when no spendSupabase.rpc call is present', () => {
    expect(
      rpcCallTargets(
        "const rows = await input.spendSupabase.from('spend').select('*');",
        'replace_google_ads_spend_daily'
      )
    ).toBe(false);
  });

  it('skips an invalid candidate before a valid matching call', () => {
    expect(
      rpcCallTargets(
        "await input.spendSupabase.rpc(\n    'replace_something_else',\n    {}\n  );\n  await input.spendSupabase.rpc('replace_google_ads_spend_daily', {});",
        'replace_google_ads_spend_daily'
      )
    ).toBe(true);
  });
});
