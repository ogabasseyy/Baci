import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function listRegularFiles(directory, baseDirectory = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRegularFiles(path, baseDirectory));
    } else if (entry.isFile()) {
      files.push(relative(baseDirectory, path));
    }
  }
  return files;
}

function guideFiles(root, directory) {
  const absoluteDirectory = resolve(root, directory);
  let files;
  try {
    files = listRegularFiles(absoluteDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new Error(`Required guide directory is missing: ${directory}`, { cause: error });
    }
    throw error;
  }
  return files.map((file) => file.split(sep).join('/')).sort();
}

export function assertGuidePrebuilt(root) {
  const appFiles = guideFiles(root, 'apps/web/public/guides');
  const rootFiles = guideFiles(root, 'public/guides');
  if (appFiles.length === 0 && rootFiles.length === 0) throw new Error('No guide files found');

  const appSet = new Set(appFiles);
  const rootSet = new Set(rootFiles);
  const missingFromRoot = appFiles.filter((file) => !rootSet.has(file));
  const missingFromApp = rootFiles.filter((file) => !appSet.has(file));
  if (missingFromRoot.length || missingFromApp.length) {
    const differences = [
      ...missingFromRoot.map((file) => `missing from public/guides: ${file}`),
      ...missingFromApp.map((file) => `missing from apps/web/public/guides: ${file}`),
    ];
    throw new Error(`Guide asset directories differ: ${differences.join('; ')}`);
  }

  const outputDirectory = resolve(root, '.vercel/output/static/guides');
  for (const file of rootFiles) {
    const appBytes = readFileSync(resolve(root, 'apps/web/public/guides', file));
    const rootBytes = readFileSync(resolve(root, 'public/guides', file));
    if (!appBytes.equals(rootBytes)) throw new Error(`Guide asset copies differ: ${file}`);

    let outputBytes;
    try {
      outputBytes = readFileSync(resolve(outputDirectory, file));
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new Error(`Prebuilt guide file is missing: ${file}`, { cause: error });
      }
      throw error;
    }
    if (!outputBytes.equals(rootBytes)) throw new Error(`Prebuilt guide file differs: ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertGuidePrebuilt(process.cwd());
  console.log('All guide files are present and identical in the Vercel prebuilt output.');
}
