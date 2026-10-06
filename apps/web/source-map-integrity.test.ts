/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { loadCjs } from './security-integrity-load-cjs';
import { resolveRoot } from './security-integrity-resolve-root';

// Behavioral coverage for CVE-2026-93749: `source-map-js`
// `SourceNode.fromStringWithSourceMap` added padding lines one by one up
// to each mapping's generated line, so a mapping far past the end of the
// code (e.g. an indexed-map section with a huge offset.line) looped
// millions of times, appending "undefined" chunks and stalling the event
// loop. Fixed in 1.2.2 by skipping to the mapping line once the code is
// exhausted.

interface SourceMapConsumerCtor {
  new (map: {
    version: number;
    sources: string[];
    names: string[];
    mappings: string;
  }): unknown;
}

interface SourceNodeModule {
  SourceNode: {
    fromStringWithSourceMap: (
      code: string,
      consumer: unknown,
      relativePath: string | null
    ) => { children: unknown[]; toString: () => string };
  };
  SourceMapConsumer: SourceMapConsumerCtor;
}

// Far enough past the end that the old loop is unmistakable (hundreds
// of thousands of padding chunks), small enough to run in milliseconds.
const FAR_LINE = 200_000;

function loadModule(): SourceNodeModule {
  const root = resolveRoot(
    'source-map-js',
    process.env.SOURCE_MAP_ROOT,
    'SOURCE_MAP_ROOT'
  );
  return loadCjs(root);
}

describe('source-map-js integrity (CVE-2026-93749)', () => {
  it('skips mappings far past the end of the code', () => {
    const { SourceNode, SourceMapConsumer } = loadModule();
    const code = 'line one\nline two\n';
    const mappings = `${';'.repeat(FAR_LINE - 1)}AAAA`;
    const consumer = new SourceMapConsumer({
      version: 3,
      sources: ['a.js'],
      names: [],
      mappings,
    });
    const node = SourceNode.fromStringWithSourceMap(code, consumer, null);
    // Fixed: a handful of chunks and byte-identical output. Pre-fix the
    // loop appended ~200k "undefined" chunks before reaching the mapping.
    expect(node.children.length).toBeLessThan(100);
    expect(node.toString()).toBe(code);
  });

  it('still maps nearby generated lines', () => {
    const { SourceNode, SourceMapConsumer } = loadModule();
    const code = 'line one\nline two\n';
    const consumer = new SourceMapConsumer({
      version: 3,
      sources: ['a.js'],
      names: [],
      mappings: 'AAAA;AACA',
    });
    const node = SourceNode.fromStringWithSourceMap(code, consumer, null);
    expect(node.toString()).toBe(code);
  });
});
