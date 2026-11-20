import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('Swift lowers the Expo async promise callback for a noncopyable result', {
  skip: process.platform !== 'darwin',
}, () => {
  const source = readFileSync(
    new URL('../../node_modules/expo-modules-core/ios/Core/Functions/AsyncFunctionDefinition.swift', import.meta.url),
    'utf8'
  );
  const callback = source.match(/\{ \[promise\] result in\n([\s\S]+?)\n      \}/)?.[1];
  assert.ok(callback, 'Expo async promise callback must be identifiable');

  const directory = mkdtempSync(join(tmpdir(), 'baci-expo-async-promise-'));
  try {
    const probe = join(directory, 'probe.swift');
    writeFileSync(probe, `
struct JavaScriptValue: Sendable, ~Copyable {}
struct JavaScriptPromise: Sendable {
  func resolve(_ value: consuming JavaScriptValue) {}
  func reject(_ error: any Error) {}
}
class Exception: Error, @unchecked Sendable {}
func observe(_ callback: @Sendable @escaping (consuming Result<JavaScriptValue, Exception>) -> Void) {}

func build(_ promise: JavaScriptPromise) {
  observe { [promise] result in
${callback}
  }
}
`);
    const result = spawnSync(
      'xcrun',
      ['swiftc', '-swift-version', '6', '-emit-silgen', probe, '-o', '/dev/null'],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
