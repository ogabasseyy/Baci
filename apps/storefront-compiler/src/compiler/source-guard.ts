import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';

export interface SourceSafetyViolation {
  filePath: string;
  rule:
    | 'DYNAMIC_CODE_EVAL'
    | 'SERVICE_WORKER_ACCESS'
    | 'DIRECT_COOKIE_ACCESS'
    | 'DANGEROUS_INNER_HTML'
    | 'PROHIBITED_RUNTIME_IMPORT';
  detail: string;
}

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

const IMPORT_KEYWORD_PREFIX_RE = /(?:^|[^\w$])(?:import|from)\s*(?:\(\s*)?$/;

/**
 * Strips JS/TS comments and masks string/template literal contents so checks do
 * not false-positive on comments or product copy. When `preserveImportSpecifiers`
 * is true, string literals immediately following `import` / `from` / `import(`
 * remain intact so executable import specifiers can be inspected accurately.
 */
function sanitizeSourceForStaticScan(
  source: string,
  preserveImportSpecifiers: boolean
): string {
  let out = '';
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      out += ' ';
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      out += ' ';
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const keepLiteral =
        preserveImportSpecifiers &&
        IMPORT_KEYWORD_PREFIX_RE.test(out.slice(-48));
      out += quote;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\') {
          if (keepLiteral) out += source.slice(i, i + 2);
          i += 2;
        } else {
          if (keepLiteral) out += source[i];
          i++;
        }
      }
      out += quote;
      i++;
      continue;
    }
    if (ch === '`') {
      out += '""';
      i++;
      while (i < len && source[i] !== '`') {
        if (source[i] === '\\') {
          i += 2;
        } else if (source[i] === '$' && source[i + 1] === '{') {
          out += ' + (';
          i += 2;
          let depth = 1;
          let expr = '';
          while (i < len && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) expr += source[i];
            i++;
          }
          out += `${sanitizeSourceForStaticScan(expr, preserveImportSpecifiers)}) + ""`;
        } else {
          i++;
        }
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function isProhibitedImportSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  if (
    trimmed.startsWith('node:') ||
    trimmed.startsWith('cloudflare:') ||
    trimmed.startsWith('workerd:') ||
    trimmed.startsWith('bun:') ||
    trimmed.startsWith('deno:') ||
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('file:')
  ) {
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

const STATIC_OR_DYNAMIC_IMPORT_RE =
  /(?:^|[^\w$])(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

export function scanManifestSourceSafety(
  manifest: WorkerStorefrontManifest
): SourceSafetyViolation[] {
  const violations: SourceSafetyViolation[] = [];

  for (const file of manifest.files) {
    if (file.path.endsWith('.css')) continue;

    const importScanSource = sanitizeSourceForStaticScan(file.content, true);
    for (const match of importScanSource.matchAll(
      STATIC_OR_DYNAMIC_IMPORT_RE
    )) {
      const specifier = match[1] ?? '';
      if (specifier && isProhibitedImportSpecifier(specifier)) {
        violations.push({
          filePath: file.path,
          rule: 'PROHIBITED_RUNTIME_IMPORT',
          detail: `Prohibited runtime specifier "${specifier}"`,
        });
      }
    }

    const stripped = sanitizeSourceForStaticScan(file.content, false);

    if (
      /\beval\s*\(/.test(stripped) ||
      /\bnew\s+Function\s*\(/.test(stripped) ||
      /\bFunction\s*\(/.test(stripped)
    ) {
      violations.push({
        filePath: file.path,
        rule: 'DYNAMIC_CODE_EVAL',
        detail: 'Dynamic code evaluation (eval / Function) is forbidden',
      });
    }

    if (/\bserviceWorker\b/.test(stripped)) {
      violations.push({
        filePath: file.path,
        rule: 'SERVICE_WORKER_ACCESS',
        detail:
          'Service Worker registration or control is forbidden on storefronts',
      });
    }

    if (
      /\bdocument\s*\.\s*cookie\b/.test(stripped) ||
      /\bcookieStore\b/.test(stripped)
    ) {
      violations.push({
        filePath: file.path,
        rule: 'DIRECT_COOKIE_ACCESS',
        detail:
          'Custom storefronts are cookie-free; use @baci/experience-sdk cart APIs',
      });
    }

    if (/\bdangerouslySetInnerHTML\b/.test(stripped)) {
      violations.push({
        filePath: file.path,
        rule: 'DANGEROUS_INNER_HTML',
        detail: 'dangerouslySetInnerHTML is forbidden in storefront components',
      });
    }
  }

  return violations;
}
