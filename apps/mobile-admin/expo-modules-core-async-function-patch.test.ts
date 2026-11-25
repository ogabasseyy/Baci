import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const coreRoot = dirname(require.resolve('expo-modules-core/package.json'));
const asyncFunctionSourcePath = join(
  coreRoot,
  'ios/Core/Functions/AsyncFunctionDefinition.swift'
);
const patchPath = join(
  __dirname,
  '../../patches/expo-modules-core@58.0.26.patch'
);

// Swift 6.4.2 (Xcode 27.2) crashes in SILGen on a cast pattern inside a `switch consume` over a
// noncopyable `Result` payload. The crash hits Debug and Release (-O) builds of ExpoModulesCore.
// Both Expo apps share the one hoisted, root-patched copy, so this also covers mobile-storefront.
const CAST_PATTERN_IN_FAILURE_CASE = /case \.failure\(let \w+ as any Error\)/;

describe('bugfix: expo-modules-core AsyncFunctionDefinition crashes the Swift 6.4.2 compiler', () => {
  it('keeps the installed async function builder free of the redundant `as any Error` cast pattern', () => {
    const source = readFileSync(asyncFunctionSourcePath, 'utf8');

    expect(source).toContain('switch consume result {');
    expect(source).not.toMatch(CAST_PATTERN_IN_FAILURE_CASE);
    expect(source).toMatch(
      /case \.failure\(let error\):\s*promise\.reject\(error\)/
    );
  });

  it('carries the fix in the pnpm patch so a fresh install reproduces it', () => {
    const patch = readFileSync(patchPath, 'utf8');
    // pnpm applies the patch only if its `-` lines match the published file: this is upstream's text.
    const removedUpstreamLine = patch.match(/^-\s+case \.failure\(.*$/m)?.[0];

    expect(patch).toContain(
      'diff --git a/ios/Core/Functions/AsyncFunctionDefinition.swift'
    );
    expect(removedUpstreamLine).toMatch(CAST_PATTERN_IN_FAILURE_CASE);
    expect(patch).toMatch(/^\+\s+case \.failure\(let error\):$/m);
  });
});
