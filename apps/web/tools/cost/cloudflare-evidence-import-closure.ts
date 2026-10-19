import { lstat, readFile, realpath } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TypeScript from '@typescript/typescript6';
import {
  type EvidenceDependencyIntegrityManifest,
  verifyEvidenceDependencyFile,
} from './cloudflare-evidence-dependency-integrity';
import { verifyReviewedEvidenceFile } from './cloudflare-evidence-runner-modules';

const appRequire = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
);
const ts = appRequire('@typescript/typescript6') as typeof TypeScript;

const MODULE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
] as const;

function staticImportSpecifiers(source: string, filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const visit = (node: TypeScript.Node) => {
    const moduleSpecifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : ts.isImportEqualsDeclaration(node) &&
            !node.isTypeOnly &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteralLike(node.moduleReference.expression)
          ? node.moduleReference.expression.text
          : ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) &&
                  node.expression.text === 'require')) &&
              node.arguments.length === 1 &&
              ts.isStringLiteralLike(node.arguments[0])
            ? node.arguments[0].text
            : undefined;
    if (moduleSpecifier) specifiers.push(moduleSpecifier);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

async function resolveLocalImport(from: string, specifier: string) {
  const requested = isAbsolute(specifier)
    ? specifier
    : resolve(dirname(from), specifier);
  const candidates = extname(requested)
    ? [requested]
    : [
        ...MODULE_EXTENSIONS.map((extension) => `${requested}${extension}`),
        ...MODULE_EXTENSIONS.slice(1).map(
          (extension) => `${requested}/index${extension}`
        ),
      ];
  for (const candidate of candidates) {
    try {
      if ((await lstat(candidate)).isFile()) return candidate;
    } catch {
      // Continue through the extension and index candidates.
    }
  }
  throw new Error('credentialed evidence command import is not a local file');
}

function packageName(specifier: string) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function packageRootFromPath(
  workspaceRoot: string,
  file: string,
  name: string
) {
  let current = dirname(file);
  while (current.startsWith(`${workspaceRoot}${sep}`)) {
    if (current.endsWith(`${sep}${name}`)) return current;
    current = dirname(current);
  }
  throw new Error(`bare package ${name} resolved outside the workspace`);
}

async function resolvePackageImport(from: string, specifier: string) {
  try {
    return await realpath(createRequire(from).resolve(specifier));
  } catch {
    throw new Error(
      `bare package ${packageName(specifier)} cannot be resolved`
    );
  }
}

export async function verifyCredentialedEvidenceCommandImportClosure(
  workspaceRoot: string,
  toolingMergeSha: string,
  entrypoint: string,
  manifest: EvidenceDependencyIntegrityManifest
) {
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const visited = new Set<string>();
  const pending: Array<{ path: string; packageName?: string }> = [
    { path: entrypoint },
  ];
  while (pending.length) {
    const current = pending.pop() as { path: string; packageName?: string };
    const currentPath = await realpath(current.path);
    if (visited.has(currentPath)) continue;
    visited.add(currentPath);
    const source = await readFile(currentPath, 'utf8');
    for (const specifier of staticImportSpecifiers(source, currentPath)) {
      if (specifier.startsWith('node:') || builtinModules.includes(specifier))
        continue;
      if (!specifier.startsWith('.') && !isAbsolute(specifier)) {
        const imported = await resolvePackageImport(currentPath, specifier);
        await verifyEvidenceDependencyFile(
          canonicalWorkspaceRoot,
          packageName(specifier),
          imported,
          manifest
        );
        pending.push({ path: imported, packageName: packageName(specifier) });
        continue;
      }
      const imported = await resolveLocalImport(currentPath, specifier);
      if (current.packageName) {
        const packageRoot = packageRootFromPath(
          canonicalWorkspaceRoot,
          currentPath,
          current.packageName
        );
        const importedCanonical = await realpath(imported);
        if (
          relative(packageRoot, importedCanonical) === '' ||
          relative(packageRoot, importedCanonical).startsWith(`..${sep}`)
        ) {
          const verified = await verifyReviewedEvidenceFile(
            canonicalWorkspaceRoot,
            toolingMergeSha,
            importedCanonical
          );
          pending.push({ path: verified.path });
        } else {
          await verifyEvidenceDependencyFile(
            canonicalWorkspaceRoot,
            current.packageName,
            importedCanonical,
            manifest
          );
          pending.push({
            path: importedCanonical,
            packageName: current.packageName,
          });
        }
      } else {
        const verified = await verifyReviewedEvidenceFile(
          canonicalWorkspaceRoot,
          toolingMergeSha,
          imported
        );
        pending.push({ path: verified.path });
      }
    }
  }
  return Object.freeze([...visited]);
}
