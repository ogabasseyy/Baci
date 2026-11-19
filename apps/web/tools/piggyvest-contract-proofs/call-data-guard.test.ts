import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard for the "a failed read is not a measurement" rule. A failed response
 * keeps its raw envelope data on purpose (`ProviderReads.runCall`), so a
 * parser or list extractor that is handed `<call>.data` directly can turn a
 * 503 into a measurement. Every such site must read the data through
 * `okData`, `recordOf` or `usableList` (read-rules.ts) instead.
 */

const PARSERS = ['safeParse', 'extractEdges', 'pickString', 'isOwnedBy'];
/** read-rules.ts is where the success check itself lives. */
const EXEMPT = new Set(['read-rules.ts']);

/** Argument texts of every parser call in `source` that mention a `.data` access. */
function rawDataArguments(source: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`\\b(?:${PARSERS.join('|')})\\(`, 'g');
  for (const match of source.matchAll(pattern)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < source.length && depth > 0) {
      const char = source[end];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      end += 1;
    }
    const args = source.slice(match.index + match[0].length, end - 1);
    if (/\.data\b/.test(args)) found.push(args.replace(/\s+/g, ' ').trim());
  }
  return found;
}

describe('rawDataArguments (the scanner itself)', () => {
  it('flags a parser handed raw call data, however it is spelled', () => {
    expect(rawDataArguments('schema.safeParse(call.data)')).toHaveLength(1);
    expect(rawDataArguments('extractEdges(created.call.data).edges')).toEqual([
      'created.call.data',
    ]);
    expect(
      rawDataArguments(
        'walletDataSchema.safeParse(\n (await api.wallet(id)).data\n)'
      )
    ).toHaveLength(1);
    expect(rawDataArguments("pickString(sent.call.data, ['id'])")).toHaveLength(
      1
    );
  });

  it('accepts data read through the success-checked helpers', () => {
    expect(rawDataArguments('schema.safeParse(okData(call))')).toEqual([]);
    expect(rawDataArguments('extractEdges(okData(await api.x()))')).toEqual([]);
    expect(rawDataArguments("pickString(edge, ['id'])")).toEqual([]);
    expect(rawDataArguments('const parsed = x.data; use(parsed)')).toEqual([]);
  });
});

describe('no module hands raw call.data to a parser', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir).filter(
    (name) =>
      name.endsWith('.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test-support.ts') &&
      !EXEMPT.has(name)
  );

  it('scans the harness sources', () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it.each(
    sources
  )('%s reads call data only through okData / recordOf / usableList', (name) => {
    const text = readFileSync(path.join(dir, name), 'utf8');
    expect(rawDataArguments(text)).toEqual([]);
  });
});
