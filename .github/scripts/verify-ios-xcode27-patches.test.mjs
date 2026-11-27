import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('expo-modules-core patch drops the cast that crashes the Swift 6.4 compiler', () => {
  const patch = read('patches/expo-modules-core@58.0.26.patch');
  // Xcode 27.2 (Swift 6.4.2) crashes in SILGen on `switch consume result`
  // when the failure case also casts: `.failure(let error as any Error)`.
  // expo-modules-core 58.2.0 binds the error without the cast.
  assert.match(patch, /ios\/Core\/Functions\/AsyncFunctionDefinition\.swift/);
  assert.match(patch, /^-\s*case \.failure\(let error as any Error\):$/m);
  assert.match(patch, /^\+\s*case \.failure\(let error\):$/m);
});

test('NitroModules public header no longer imports the cxxreact module', () => {
  const patch = read('patches/react-native-nitro-modules@0.37.2.patch');
  // Pods that build on Nitro (react-native-mmkv, splash motion, the app) import
  // ReactNativeCore.hpp through Nitro's umbrella; under Xcode 27 explicit modules
  // that built all of cxxreact and failed. Only RawPropsCompat.cpp needs the version.
  const header = patch.split(/^diff --git /m).find((part) =>
    part.startsWith('a/cpp/views/ReactNativeCore.hpp'),
  );
  const source = patch.split(/^diff --git /m).find((part) =>
    part.startsWith('a/cpp/views/RawPropsCompat.cpp'),
  );
  assert.ok(header, 'patch must edit cpp/views/ReactNativeCore.hpp');
  assert.ok(source, 'patch must edit cpp/views/RawPropsCompat.cpp');
  assert.match(header, /^-#include <cxxreact\/ReactNativeVersion\.h>$/m);
  assert.match(source, /^\+#include <cxxreact\/ReactNativeVersion\.h>$/m);
});

// Walks the installed (patched) NitroModules header graph from every public
// header in the podspec, following quoted includes inside the package.
function publicHeaderGraphIncludes(nitroRoot) {
  const podspec = readFileSync(join(nitroRoot, 'NitroModules.podspec'), 'utf8');
  const publicBlock = podspec.match(/s\.public_header_files = \[([\s\S]*?)\]/)?.[1] ?? '';
  const queue = [...publicBlock.matchAll(/"([^"]+\.hpp)"/g)].map((m) => join(nitroRoot, m[1]));
  assert.ok(queue.length > 10, 'podspec public header list must be readable');
  const seen = new Set();
  const angleIncludes = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const quoted = line.match(/^\s*#\s*include\s+"([^"]+)"/);
      if (quoted) queue.push(resolve(dirname(file), quoted[1]));
      const angle = line.match(/^\s*#\s*include\s+<([^>]+)>/);
      if (angle) angleIncludes.push({ file: file.slice(nitroRoot.length + 1), header: angle[1] });
    }
  }
  return { headers: seen, angleIncludes };
}

const installedNitro = process.env.NITRO_MODULES_DIR ?? join(root, 'node_modules/react-native-nitro-modules');

test('installed NitroModules public headers never reach the cxxreact module', {
  skip: existsSync(join(installedNitro, 'NitroModules.podspec')) ? false : 'react-native-nitro-modules is not installed',
}, () => {
  const { headers, angleIncludes } = publicHeaderGraphIncludes(installedNitro);
  assert.ok(
    [...headers].some((file) => file.endsWith('cpp/views/ReactNativeCore.hpp')),
    'the walk must reach ReactNativeCore.hpp through the public view headers',
  );
  const cxxreact = angleIncludes.filter(({ header }) => header.startsWith('cxxreact/'));
  assert.deepEqual(cxxreact, [], 'public headers must not include <cxxreact/...>');

  const rawProps = readFileSync(join(installedNitro, 'cpp/views/RawPropsCompat.cpp'), 'utf8');
  const versionInclude = rawProps.indexOf('#include <cxxreact/ReactNativeVersion.h>');
  assert.ok(versionInclude >= 0, 'RawPropsCompat.cpp must include the version header itself');
  assert.ok(
    versionInclude < rawProps.indexOf('REACT_NATIVE_VERSION_MINOR'),
    'the version header must come before the first version macro use',
  );
});

const xcodeWorkflows = [
  '.github/workflows/ios-storefront-release.yml',
  '.github/workflows/ios-release.yml',
  '.github/workflows/ios-runtime-scheduler-pr.yml',
];

for (const path of xcodeWorkflows) {
  test(`${path} builds with Xcode 27.2 on the xcode-27 runner`, () => {
    const workflow = read(path);
    assert.match(workflow, /^ {2}XCODE_VERSION: '27\.2'$/m);
    assert.doesNotMatch(workflow, /runs-on: macos-26\b/);
    assert.match(workflow, /runs-on: xcode-27$/m);
  });
}
