import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const APP_ROOT = new URL('../../../apps/mobile-storefront/', import.meta.url);

export function resolveHostedStagingPushConfig(
  environment,
  pins,
  observeDotenvPath = () => undefined
) {
  const cache = new Map();
  const isolatedEnvironment = { ...environment };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = createRequire(filename);
    const source = readFileSync(filename, 'utf8');
    const code = filename.endsWith('.ts')
      ? ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
          fileName: filename,
        }).outputText
      : source;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      __dirname: dirname(filename),
      process: { env: isolatedEnvironment },
      console: { warn: () => undefined },
      require(name) {
        if (name.endsWith('/hosted-storefront-pins.json')) return pins;
        if (name === 'dotenv')
          return {
            config: ({ path }) => {
              observeDotenvPath(path);
              return { parsed: {} };
            },
          };
        if (name.includes('development-storefront-expo-config')) {
          const target = resolve(dirname(filename), name);
          if (name.endsWith('.ts') || name.endsWith('.js')) return load(target);
          return load(`${target}.js`);
        }
        return localRequire(name);
      },
    });
    return module.exports;
  }
  const config = load(
    fileURLToPath(new URL('app.config.ts', APP_ROOT))
  ).default;
  return config({ config: {} });
}
