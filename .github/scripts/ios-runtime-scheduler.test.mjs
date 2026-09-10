import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const relativeHeader = 'apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h';
const patchPath = join(root, 'patches/expo-modules-jsi@57.0.5.patch');

test('committed expo-modules-jsi patch drops SWIFT_RETURNS_RETAINED on RuntimeScheduler ctors', () => {
  const patch = readFileSync(patchPath, 'utf8');
  assert.match(patch, /RuntimeScheduler\.h/);
  assert.match(
    patch,
    /-\s*(?:SWIFT_RETURNS_RETAINED\s+)?RuntimeScheduler\(/,
  );
  assert.doesNotMatch(
    patch,
    /\+\s*SWIFT_RETURNS_RETAINED\s+RuntimeScheduler\(/,
  );
});

// Run with Xcode 26.x, matching the release compiler generation. Xcode 27
// introduced different foreign-reference ownership diagnostics: reevaluate the
// compatibility patch before upgrading the workflow (expo/expo#49120).
test('Swift accepts both RuntimeScheduler constructors after the compatibility patch', {
  skip: process.platform !== 'darwin',
}, () => {
  // Arrange: recover the upstream failing header even after pnpm applied it.
  const installed = readFileSync(join(root, 'node_modules/expo-modules-jsi', relativeHeader), 'utf8');
  const original = installed.replace(/^(\s*)(?:SWIFT_RETURNS_RETAINED )?RuntimeScheduler\((void \*scheduler, ScheduleFn fn|)\)/gm,
    '$1SWIFT_RETURNS_RETAINED RuntimeScheduler($2)');
  const folder = mkdtempSync(join(tmpdir(), 'baci-swift-scheduler-'));
  const header = join(folder, relativeHeader);
  mkdirSync(dirname(header), { recursive: true });
  writeFileSync(header, original);
  writeFileSync(join(folder, 'module.modulemap'), `module RuntimeSchedulerRegression { header "${relativeHeader}" export * }\n`);
  writeFileSync(join(folder, 'probe.swift'), `import RuntimeSchedulerRegression
func probe() {
  let fallback = expo.RuntimeScheduler()
  let bound = expo.RuntimeScheduler(nil, nil)
  _ = fallback.supportsAsyncScheduling()
  _ = bound.supportsAsyncScheduling()
}
`);
  const compile = (cache) => spawnSync('xcrun', ['swiftc', '-typecheck', '-warnings-as-errors',
    '-swift-version', '6', '-cxx-interoperability-mode=default', '-I', folder,
    '-module-cache-path', join(folder, cache), join(folder, 'probe.swift')], { encoding: 'utf8' });
  try {
    // Act/assert: ensure this toolchain actually reproduces the CI diagnostic.
    const before = compile('original-cache');
    assert.notEqual(before.status, 0, 'Original header must reproduce the ownership diagnostic');
    assert.match(before.stderr, /not returning a SWIFT_SHARED_REFERENCE type/);

    // Act: apply the exact committed patch, not an equivalent test-only change.
    const patch = spawnSync('patch', ['--batch', '-p1', '-i', join(root, 'patches/expo-modules-jsi@57.0.5.patch')],
      { cwd: folder, encoding: 'utf8' });
    assert.equal(patch.status, 0, patch.stderr || patch.stdout);
    const after = compile('patched-cache');

    // Assert: both imported constructor paths compile without diagnostics.
    assert.equal(after.status, 0, after.stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
