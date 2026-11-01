import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { packageManager } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
);

test('installs patched packages in multiple hoisted locations after lifecycle builds', {
  timeout: 120_000,
}, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'baci-hoisted-patch-')));
  const pack = (name, version, dependencies = {}) => {
    const source = join(root, `${name}-${version}`);
    mkdirSync(source);
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({
        name,
        version,
        main: 'index.js',
        dependencies,
        scripts: { postinstall: 'node build.cjs' },
      })
    );
    writeFileSync(
      join(source, 'index.js'),
      `module.exports = { version: '${version}', patched: false };\n`
    );
    writeFileSync(
      join(source, 'build.cjs'),
      "require('node:fs').writeFileSync('built.txt', 'built');\n"
    );
    const archive = join(root, `${name}-${version}.tgz`);
    const result = spawnSync(
      'tar',
      ['-czf', archive, '-C', root, `${name}-${version}`],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    return `file:${archive}`;
  };
  try {
    const legacy = pack('baci-fixture-shared', '1.0.0');
    const modern = pack('baci-fixture-shared', '2.0.0');
    const parents = ['baci-fixture-parent-a', 'baci-fixture-parent-b'];
    const dependencies = { 'baci-fixture-shared': modern };
    for (const name of parents) {
      dependencies[name] = pack(name, '1.0.0', {
        'baci-fixture-shared': legacy,
      });
    }
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify({
        name: 'hoisted-patch-regression',
        private: true,
        packageManager,
        dependencies,
      })
    );
    writeFileSync(
      join(workspace, 'pnpm-workspace.yaml'),
      `packages:\n  - '.'\nnodeLinker: hoisted\n# Every package is a self-authored local fixture; no registry packages are allowed.\ndangerouslyAllowAllBuilds: true\npatchedDependencies:\n  baci-fixture-shared@1.0.0: shared-1.patch\n  baci-fixture-shared@2.0.0: shared-2.patch\n`
    );
    for (const version of ['1.0.0', '2.0.0']) {
      writeFileSync(
        join(workspace, `shared-${version[0]}.patch`),
        `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-module.exports = { version: '${version}', patched: false };\n+module.exports = { version: '${version}', patched: true };\n`
      );
    }
    const install = spawnSync(
      'pnpm',
      [
        'install',
        '--offline',
        '--node-linker=hoisted',
        '--config.optimistic-repeat-install=false',
      ],
      {
        cwd: workspace,
        env: { ...process.env, PNPM_MAX_WORKERS: '2' },
        encoding: 'utf8',
        timeout: 90_000,
      }
    );
    assert.equal(
      install.status,
      0,
      `${install.error ?? ''}\n${install.stdout}\n${install.stderr}`
    );
    const probe = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const { createRequire } = require('node:module');
      const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
      assert.deepEqual(rootRequire('baci-fixture-shared'), { version: '2.0.0', patched: true });
      const locations = new Set();
      for (const parent of ${JSON.stringify(parents)}) {
        const nestedRequire = createRequire(rootRequire.resolve(parent));
        const entry = nestedRequire.resolve('baci-fixture-shared');
        locations.add(entry);
        assert.deepEqual(nestedRequire('baci-fixture-shared'), { version: '1.0.0', patched: true });
        assert.equal(fs.readFileSync(path.join(path.dirname(entry), 'built.txt'), 'utf8'), 'built');
      }
      assert.equal(locations.size, 2, 'fixture must exercise distinct nested hoisted destinations');
    `,
      ],
      { cwd: workspace, encoding: 'utf8' }
    );
    assert.equal(probe.status, 0, probe.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
