import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function createSourceLoader(roots) {
  const cache = new Map();
  const sources = new Map();
  const allowedRoots = roots.map((root) => realpathSync(root));

  function track(filename) {
    const path = realpathSync(filename);
    const root = allowedRoots.find((candidate) => {
      const suffix = relative(candidate, path);
      return suffix !== '..' && !suffix.startsWith('../');
    });
    if (!root) throw new Error('Source outside approved worktrees');
    const source = readFileSync(path);
    sources.set(path, createHash('sha256').update(source).digest('hex'));
    return source;
  }

  function load(filename) {
    const path = realpathSync(filename);
    if (cache.has(path)) return cache.get(path).exports;
    const source = track(path).toString('utf8');
    const module = { exports: {} };
    cache.set(path, module);
    const localRequire = createRequire(path);
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: path,
    }).outputText;
    const appRoot = path.split('/apps/')[0];
    const appName = path.includes('/apps/mobile-storefront/')
      ? 'mobile-storefront'
      : 'web';
    const sourceRequire = (name) => {
      if (name === 'server-only') return {};
      if (name === 'zod' || name.startsWith('node:')) return localRequire(name);
      if (!name.startsWith('.') && !name.startsWith('@/'))
        throw new Error('Non-contract dependency refused');
      const target = name.startsWith('@/')
        ? resolve(
            appRoot,
            'apps',
            appName,
            appName === 'web' ? 'src' : '.',
            name.slice(2)
          )
        : resolve(dirname(path), name);
      const candidate = [target, `${target}.ts`, `${target}.tsx`].find(
        (value) => existsSync(value)
      );
      if (!candidate) throw new Error('Contract dependency missing');
      return load(candidate);
    };
    const wrapper = vm.runInThisContext(
      `(function(exports,require,module,__filename,__dirname,process){${code}\n})`,
      { filename: path }
    );
    wrapper(module.exports, sourceRequire, module, path, dirname(path), {
      env: Object.freeze({}),
    });
    return module.exports;
  }

  return {
    load,
    track,
    manifest() {
      const entries = [...sources].sort(([left], [right]) =>
        left.localeCompare(right)
      );
      const text = entries.map(([path, hash]) => `${hash}  ${path}`).join('\n');
      return {
        sourceCount: entries.length,
        sha256: createHash('sha256').update(text).digest('hex'),
        entries: entries.map(([path, sha256]) => ({ path, sha256 })),
      };
    },
  };
}
