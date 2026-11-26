const BANNED_RUNTIME_SPECIFIERS: ReadonlySet<string> = new Set([
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'perf_hooks',
  'process',
  'readline',
  'repl',
  'stream',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
]);

const BANNED_IMPORT_PREFIXES = [
  'node:',
  'cloudflare:',
  'workerd:',
  'bun:',
  'deno:',
  'http:',
  'https:',
  'data:',
  'file:',
] as const;

export const SENSITIVE_GLOBAL_ROOTS: ReadonlySet<string> = new Set([
  'globalThis',
  'window',
  'self',
  'document',
  'navigator',
]);

export const DYNAMIC_CODE_NAMES: ReadonlySet<string> = new Set([
  'eval',
  'Function',
  'constructor',
]);

export function isProhibitedImportSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  if (BANNED_IMPORT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  const rootName = trimmed.startsWith('@')
    ? trimmed.split('/').slice(0, 2).join('/')
    : (trimmed.split('/')[0] ?? '');
  return (
    BANNED_RUNTIME_SPECIFIERS.has(trimmed) ||
    BANNED_RUNTIME_SPECIFIERS.has(rootName)
  );
}
