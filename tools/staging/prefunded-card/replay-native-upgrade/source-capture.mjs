import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { authority } from './constants.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const core = new Set(builtinModules.map((value) => value.replace(/^node:/, '')));
const inside = (root, filename) => filename === root || filename.startsWith(root + path.sep);

export async function createSourceCapture({ repository, overlays }) {
  const root = await realpath(repository);
  const snapshots = new Map();
  const loaded = new Map();
  const overlayMap = new Map(overlays.map((row) => [row.target, row]));
  const used = new Set();
  const absent = new Set();
  async function assertAbsent(filename) {
    const state = await lstat(filename).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (state || await realpath(path.dirname(filename)) !== path.dirname(filename))
      throw new Error('Reviewed new canonical source must remain absent');
    absent.add(filename);
  }
  async function observe(filename) {
    const absolute = path.resolve(filename);
    const before = await lstat(absolute);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 16_000_000)
      throw new Error('Expected bounded regular source');
    const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (before.dev !== opened.dev || before.ino !== opened.ino || before.size !== opened.size
          || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs
          || opened.ctimeMs !== after.ctimeMs) throw new Error('Source changed during capture');
      const sha256 = digest(bytes);
      if (snapshots.has(absolute) && snapshots.get(absolute).sha256 !== sha256)
        throw new Error('Source changed during capture');
      snapshots.set(absolute, { sha256, bytes });
      return { sha256, bytes };
    } finally {
      await handle.close();
    }
  }
  function classify(filename) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    if (!inside(root, filename)) throw new Error('Source outside canonical closure');
    const dependency = relative.includes('/node_modules/') || relative.startsWith('node_modules/');
    if (dependency) {
      const name = relative.match(/(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/)?.[1];
      if (!authority.packages.includes(name)) throw new Error('Package outside worker dependency policy');
    } else if (!authority.sourceRoots.some((prefix) => relative.startsWith(prefix))) {
      throw new Error('Source outside worker source policy');
    }
    return { relative, dependency };
  }
  for (const row of overlays) {
    const filename = path.join(root, row.target);
    if (row.canonicalSha256 === null && !authority.newTargets.includes(row.target))
      throw new Error('Unapproved absent canonical source');
    const original = row.canonicalSha256 === null ? (await assertAbsent(filename), null) : await observe(filename);
    const replacement = await observe(row.filename);
    if ((original?.sha256 ?? null) !== row.canonicalSha256 || replacement.sha256 !== row.replacementSha256)
      throw new Error('Reviewed overlay source pin differs');
  }
  const plugin = {
    name: 'replay-native-canonical-overlay',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const candidate = args.path.startsWith('@/') ? path.join(root, 'apps/web/src', args.path.slice(2))
          : args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : null;
        if (!candidate) return;
        for (const target of authority.newTargets) {
          if (overlayMap.has(target) && (candidate === path.join(root, target)
            || candidate + '.ts' === path.join(root, target))) return { path: path.join(root, target) };
        }
      });
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty-server-only' }));
      builder.onLoad({ filter: /.*/, namespace: 'empty-server-only' }, () => ({ contents: '' }));
      builder.onLoad({ filter: /.*/, namespace: 'file' }, async (args) => {
        const absolute = path.resolve(args.path);
        const { relative, dependency } = classify(absolute);
        const row = overlayMap.get(relative);
        if (row?.canonicalSha256 === null) await assertAbsent(absolute);
        else if (!dependency && await realpath(absolute) !== absolute) throw new Error('Symlinked canonical source refused');
        const loaders = { '.cjs': 'js', '.js': 'js', '.json': 'json', '.mjs': 'js', '.ts': 'ts', '.tsx': 'tsx' };
        const loader = loaders[path.extname(absolute)];
        if (!loader) throw new Error('Source extension outside worker policy');
        const original = row?.canonicalSha256 === null ? null : await observe(absolute);
        const compiled = row ? await observe(row.filename) : original;
        if (row && ((original?.sha256 ?? null) !== row.canonicalSha256 || compiled.sha256 !== row.replacementSha256))
          throw new Error('Reviewed overlay source pin differs');
        if (row) used.add(relative);
        loaded.set(relative, { filename: absolute, dependency, compiledSha256: compiled.sha256,
          canonicalBeforeSha256: original?.sha256 ?? null, ...(row ? {
            receiverFilename: row.filename, receiverBeforeSha256: compiled.sha256,
          } : {}) });
        return { contents: compiled.bytes, loader, resolveDir: path.dirname(absolute) };
      });
    },
  };
  return {
    plugin,
    async trackControl(filename) { return (await observe(filename)).sha256; },
    async seal(metafile) {
      for (const row of overlays) if (!used.has(row.target)) throw new Error('Declared unused overlay');
      for (const [input, metadata] of Object.entries(metafile.inputs)) {
        if (input === '<stdin>' || input === 'empty-server-only:server-only') continue;
        const relative = path.relative(root, path.resolve(root, input)).split(path.sep).join('/');
        if (!loaded.has(relative)) throw new Error('Uncaptured source in compiled closure');
        for (const imported of metadata.imports) {
          if (imported.external && imported.path !== 'pg-native'
              && !core.has(imported.path.replace(/^node:/, '')))
            throw new Error('Unexpected external import outside worker policy');
        }
      }
      const before = [...snapshots];
      for (const filename of absent) await assertAbsent(filename);
      for (const [filename, snapshot] of before) {
        if ((await observe(filename)).sha256 !== snapshot.sha256) throw new Error('Source changed during capture');
      }
      const sources = {};
      for (const [relative, row] of [...loaded].sort()) {
        sources[relative] = { ...row, canonicalAfterSha256: snapshots.get(row.filename)?.sha256 ?? null,
          ...(row.receiverFilename ? { receiverAfterSha256: snapshots.get(row.receiverFilename).sha256 } : {}),
          snapshot: 'captures/' + row.compiledSha256 + '.source' };
      }
      const captures = new Map([...snapshots.values()].map((snapshot) => [snapshot.sha256, snapshot.bytes]));
      const observed = Object.fromEntries(before.map(([filename, value]) => [filename, {
        beforeSha256: value.sha256, afterSha256: snapshots.get(filename).sha256,
        snapshot: 'captures/' + value.sha256 + '.source',
      }]));
      for (const filename of absent) observed[filename] = { beforeSha256: null, afterSha256: null, snapshot: null };
      return { sources, captures, observed };
    },
  };
}
