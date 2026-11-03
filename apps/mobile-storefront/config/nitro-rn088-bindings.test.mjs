import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
test('Nitro implements the RN 0.88 JSI installer selector and uses its call invoker', () => {
  const source = readFileSync(
    join(
      dirname(require.resolve('react-native-nitro-modules/package.json')),
      'ios/turbomodule/NativeNitroModules+NewArch.mm'
    ),
    'utf8'
  );
  assert.match(
    source,
    /installJSIBindingsWithRuntime:\(jsi::Runtime&\)runtime\s+callInvoker:\(const std::shared_ptr<react::CallInvoker>&\)callInvoker\s*\{\s*_callInvoker = callInvoker;\s*\[self installJSIBindingsWithRuntime:runtime\];/
  );
});
