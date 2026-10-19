import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const builderEntrypoints = [
  '../../app/api/builder/ai-edit/route.ts',
  '../../app/api/builder/gemini/route.ts',
  './run-builder-ai-provider-chain.ts',
];

const forbiddenSourceFragments = [
  '@/env',
  '@/ai/copilot-provider-chain',
  '@/ai/provider',
  '@ai-sdk/google-vertex',
  '@google/generative-ai',
  'GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_VERTEX_PROJECT',
  'GOOGLE_VERTEX_LOCATION',
  'createVertex',
  'aiplatform.googleapis.com',
  'googleapis.com/v1beta',
  'generateObjectWithChain',
  'getCopilotTextProviderChain',
  'process-ai-storefront-jobs',
  'storefront_layout_generation',
  'trigger-storefront-worker',
  'ollama-storefront-client',
];

const sourceRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const workspaceRoot = resolve(sourceRoot, '../../..');

function resolveLocalImport(
  fromFile: string,
  specifier: string
): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith('@baci/shared/')
      ? resolve(workspaceRoot, 'packages/shared/src', specifier.slice(13))
      : specifier === '@baci/shared'
        ? resolve(workspaceRoot, 'packages/shared/src')
        : specifier.startsWith('.')
          ? resolve(dirname(fromFile), specifier)
          : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    base,
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function collectExecutableClosure(entrypoints: string[]): string[] {
  const pending = entrypoints.map((entrypoint) =>
    resolve(dirname(new URL(import.meta.url).pathname), entrypoint)
  );
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
    )) {
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const sourceLine = source.slice(
        lineStart,
        source.indexOf('\n', lineStart)
      );
      if (/^\s*import\s+type\b/.test(sourceLine)) continue;
      const dependency = resolveLocalImport(
        file,
        match[1] ?? match[2] ?? match[3] ?? ''
      );
      if (dependency) pending.push(dependency);
    }
  }
  return [...visited];
}

describe('builder AI import closure', () => {
  it('keeps the full executable dependency graph independent from legacy provider chains', () => {
    const closure = collectExecutableClosure([
      ...builderEntrypoints,
      './builder-ai-import-closure.workspace-fixture.ts',
    ]);

    expect(closure.length).toBeGreaterThan(builderEntrypoints.length);
    expect(
      closure.some((file) => file.includes('/packages/shared/src/contracts/'))
    ).toBe(true);
    for (const file of closure) {
      expect(file).not.toContain('/src/ai/');
      expect(file).not.toContain(
        '/app/api/builder/gemini/run-builder-provider-chain'
      );
      expect(file).not.toContain(
        '/app/api/builder/gemini/route-provider-errors'
      );
      const source = readFileSync(file, 'utf8');
      expect(file).not.toContain('/src/scripts/');
      for (const forbiddenFragment of forbiddenSourceFragments) {
        expect(source).not.toContain(forbiddenFragment);
      }
    }
  });
});
