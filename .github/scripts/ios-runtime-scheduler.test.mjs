import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const header = join(root, 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h');

test('resolved RuntimeScheduler uses upstream retained factories instead of annotated constructors', () => {
  const source = readFileSync(header, 'utf8');
  assert.doesNotMatch(source, /SWIFT_RETURNS_RETAINED\s+RuntimeScheduler\(/);
  assert.match(source, /static RuntimeScheduler \*create\(void \*scheduler, ScheduleFn fn\) noexcept SWIFT_RETURNS_RETAINED/);
  assert.match(source, /static RuntimeScheduler \*create\(\) noexcept SWIFT_RETURNS_RETAINED/);
});

test('Swift accepts both upstream RuntimeScheduler factories with explicit ownership', {
  skip: process.platform !== 'darwin',
}, () => {
  const folder = mkdtempSync(join(tmpdir(), 'baci-swift-scheduler-'));
  try {
    const source = readFileSync(header, 'utf8');
    writeFileSync(join(folder, 'RuntimeScheduler.h'), source);
    writeFileSync(join(folder, 'module.modulemap'), 'module RuntimeSchedulerRegression { header "RuntimeScheduler.h" export * }\n');
    writeFileSync(join(folder, 'probe.swift'), `import RuntimeSchedulerRegression
func probe() {
  guard let fallback = expo.RuntimeScheduler.create(),
        let bound = expo.RuntimeScheduler.create(nil, nil) else { return }
  _ = fallback.supportsAsyncScheduling()
  _ = bound.supportsAsyncScheduling()
}
`);
    const compile = () => spawnSync('xcrun', ['swiftc', '-typecheck', '-warnings-as-errors',
      '-swift-version', '6', '-cxx-interoperability-mode=default', '-I', folder,
      '-module-cache-path', join(folder, 'cache'), join(folder, 'probe.swift')], { encoding: 'utf8' });
    const version = spawnSync('xcrun', ['swiftc', '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    const match = version.stdout.match(/Swift version (\d+)\.(\d+)/);
    assert.ok(match, 'Swift compiler version must be identifiable');
    const [major, minor] = match.slice(1).map(Number);
    // Missing factory ownership is diagnosed starting in Swift 6.4 (Xcode 27).
    // Xcode 26 must still compile the installed, explicitly retained factories.
    if (major > 6 || (major === 6 && minor >= 4)) {
      writeFileSync(join(folder, 'RuntimeScheduler.h'), source.replace(/noexcept SWIFT_RETURNS_RETAINED/g, 'noexcept'));
      const before = compile();
      assert.notEqual(before.status, 0, 'Missing factory ownership must fail Swift 6.4 interop');
    }
    writeFileSync(join(folder, 'RuntimeScheduler.h'), source);
    const after = compile();
    assert.equal(after.status, 0, after.stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
