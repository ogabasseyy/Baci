import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function staticGraph(root, entrypoints) {
  const sources = {};
  const imports = {};
  const options = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: path.join(root, 'apps/web'),
    paths: {
      '@/*': ['./src/*'],
      '@baci/shared/*': ['../../packages/shared/src/*'],
    },
  };
  const pending = Object.values(entrypoints);
  while (pending.length) {
    const relative = pending.pop();
    if (Object.hasOwn(sources, relative)) continue;
    if (
      !/^(apps\/web\/src\/|packages\/shared\/src\/|tools\/staging\/prefunded-card\/)/.test(
        relative
      ) ||
      relative.split('/').includes('..') ||
      /\.(test|spec|fixture)\./.test(relative)
    )
      throw new Error(`Static source outside bounded graph: ${relative}`);
    const filename = path.join(root, relative);
    const metadata = await lstat(filename);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Unsafe static source');
    const content = await readFile(filename);
    sources[relative] = digest(content);
    imports[relative] = [];
    for (const imported of ts.preProcessFile(content.toString(), true, true)
      .importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        filename,
        options,
        ts.sys
      ).resolvedModule;
      const local = resolved && !resolved.isExternalLibraryImport;
      if (!resolved && /^(\.|@\/|@baci\/shared\/)/.test(imported.fileName))
        throw new Error(
          `Unresolved local static import: ${relative}: ${imported.fileName}`
        );
      const target = local
        ? path
            .relative(root, resolved.resolvedFileName)
            .split(path.sep)
            .join('/')
        : imported.fileName;
      imports[relative].push({
        specifier: imported.fileName,
        target,
        external: !local,
      });
      if (local) pending.push(target);
    }
  }
  for (const [relative, expected] of Object.entries(sources)) {
    if (digest(await readFile(path.join(root, relative))) !== expected)
      throw new Error(`Static source drift: ${relative}`);
  }
  return {
    entrypoints,
    sources: Object.fromEntries(Object.entries(sources).sort()),
    imports,
  };
}
