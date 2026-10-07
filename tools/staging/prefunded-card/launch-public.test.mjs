import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const bundle = await build({
  entryPoints: [path.join(directory, 'launch-public.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['pg'],
  plugins: [
    {
      name: 'server-only',
      setup(plugin) {
        plugin.onResolve({ filter: /^server-only$/ }, () => ({
          path: 'server-only',
          namespace: 'empty-server-only',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'empty-server-only' }, () => ({
          contents: '',
        }));
      },
    },
  ],
  tsconfig: path.join(directory, '../../../apps/web/tsconfig.json'),
});

for (const [reason, overrides] of Object.entries({
  linked: { nlink: 2 },
  oversized: { size: 65537 },
  empty: { size: 0 },
  writable: { mode: 0o666 },
  directory: { isFile: () => false },
  malformed: {},
})) {
  test(`refuses ${reason} config without starting a service or logging credentials`, async () => {
    let started = false;
    let closed = false;
    let output = '';
    const process = {
      argv: ['node', '/app/launch-public.cjs'],
      env: { SECRET: 'private-test-value' },
      stderr: {
        write: (message) => {
          output += message;
        },
      },
      chdir: () => {
        throw new Error('unexpected directory change');
      },
    };
    const filesystem = {
      constants,
      openSync: (name, flags) => {
        assert.equal(name, '/run/pvb-public/checkout.json');
        assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW);
        return 10;
      },
      fstatSync: () => ({
        isFile: () => true,
        nlink: 1,
        size: 5,
        mode: 0o444,
        ...overrides,
      }),
      readFileSync: () => '{invalid JSON containing private-test-value',
      closeSync: () => {
        closed = true;
      },
    };
    await vm.runInNewContext(bundle.outputFiles[0].text, {
      Buffer,
      process,
      module: { exports: {} },
      exports: {},
      require: (name) => {
        if (name === 'pg') return { Client: class {} };
        if (name === 'node:fs') return filesystem;
        if (name === 'node:module')
          return {
            createRequire: () => () => {
              started = true;
            },
          };
        throw new Error('Unexpected dependency');
      },
    });
    assert.equal(started, false);
    assert.equal(closed, true);
    assert.equal(process.exitCode, 1);
    assert.equal(
      output,
      '{"status":"first-card-launch-refused","redacted":true}\n'
    );
    assert.equal(process.env.SECRET, 'private-test-value');
  });
}
