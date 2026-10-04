import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const patchPath = join(root, 'patches/expo-modules-core@57.0.12.patch');
const workspacePath = join(root, 'pnpm-workspace.yaml');
const lockfilePath = join(root, 'pnpm-lock.yaml');

test('committed expo-modules-core patch replaces the Swift 6 data-race capture', () => {
  const patch = readFileSync(patchPath, 'utf8');
  assert.match(patch, /ios\/Core\/Events\/EventEmitter\.swift/);

  // The Xcode 26 failure: `nonisolated(unsafe)` on the weak emitter capture is
  // rejected under the pod's Swift 6 complete checking. Both emit overloads
  // must drop it.
  const unsafeRemovals =
    patch.match(/^-\s*nonisolated\(unsafe\) weak let emitter = self$/gm) ?? [];
  assert.equal(
    unsafeRemovals.length,
    2,
    'both nonisolated(unsafe) weak emitter captures must be removed',
  );

  // The upstream fix (expo/expo main, EventEmitter.swift): wrap the emitter in
  // the weak @unchecked Sendable box already shipped in 57.0.12's
  // Utilities.swift, so nothing non-Sendable crosses into @JavaScriptActor.
  const boxAdditions =
    patch.match(/^\+\s*let emitter = NonisolatedUnsafeWeakVar\(self\)$/gm) ?? [];
  assert.equal(
    boxAdditions.length,
    2,
    'both emit overloads must capture via NonisolatedUnsafeWeakVar',
  );

  // The guards must read through the box; the bare `guard let emitter` form
  // only compiles against the removed declaration.
  const guardAdditions =
    patch.match(/^\+\s*guard let emitter = emitter\.value/gm) ?? [];
  assert.equal(
    guardAdditions.length,
    2,
    'both guards must unwrap through the box',
  );

  assert.doesNotMatch(patch, /^\+.*nonisolated\(unsafe\)/m);
});

test('expo-modules-core patch stays wired through install', () => {
  const workspace = readFileSync(workspacePath, 'utf8');
  assert.match(
    workspace,
    /"expo-modules-core@57\.0\.12":\s*"patches\/expo-modules-core@57\.0\.12\.patch"/,
    'pnpm-workspace.yaml must map expo-modules-core to the patch',
  );

  // Without this key every --frozen-lockfile install (all CI jobs and both
  // iOS releases) fails before compiling anything.
  const lockfile = readFileSync(lockfilePath, 'utf8');
  assert.match(
    lockfile,
    /^ {2}expo-modules-core@57\.0\.12: [0-9a-f]{64}$/m,
    'pnpm-lock.yaml patchedDependencies must record the patch hash',
  );
  assert.match(
    lockfile,
    /expo-modules-core@57\.0\.12\(patch_hash=/,
    'pnpm-lock.yaml snapshots must reference the patched package',
  );
});

// The committed patch targets Xcode 26.2-era complete checking, which is not
// reproducible standalone on newer toolchains; what a unit test can prove is
// that the backported capture pattern itself is concurrency-clean under
// Swift 6 complete checking with warnings as errors.
test('NonisolatedUnsafeWeakVar capture is clean under Swift 6 complete checking', {
  skip: process.platform !== 'darwin' ? 'requires a macOS Swift toolchain' : false,
}, () => {
  const folder = mkdtempSync(join(tmpdir(), 'baci-swift-emitter-'));
  try {
    writeFileSync(join(folder, 'probe.swift'), `import Foundation
@globalActor actor JSActor {
  static let shared = JSActor()
}
final class NonisolatedUnsafeWeakVar<VarType: AnyObject>: @unchecked Sendable {
  nonisolated(unsafe) weak var value: VarType?
  init(_ value: VarType?) {
    self.value = value
  }
}
struct JSObject: ~Copyable {}
struct JSValue {
  var any: Any?
}
final class FakeRuntime {
  func schedule(_ closure: @escaping @JSActor () -> sending Void) {}
}
protocol FakeEmitter: AnyObject {
  @JSActor func withTarget<R>(_ body: (borrowing JSObject) throws -> R) rethrows -> R?
}
func dispatch(event: String, payload: JSValue, to target: borrowing JSObject) {}
final class FakeModule: FakeEmitter {
  @JSActor func withTarget<R>(_ body: (borrowing JSObject) throws -> R) rethrows -> R? {
    nil
  }
}
func emit(event: String, payload: JSValue, emitterSelf: FakeModule, runtime: FakeRuntime) {
  let emitter = NonisolatedUnsafeWeakVar(emitterSelf)
  runtime.schedule {
    guard let emitter = emitter.value else {
      return
    }
    let dispatched = emitter.withTarget { target in
      dispatch(event: event, payload: payload, to: target)
      return true
    }
    _ = dispatched
  }
}
`);
    const compile = spawnSync('xcrun', ['swiftc', '-typecheck', '-swift-version', '6', '-warnings-as-errors',
      '-module-cache-path', join(folder, 'cache'), join(folder, 'probe.swift')], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
