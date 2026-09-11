import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const storefrontDir = dirname(fileURLToPath(import.meta.url));

export function readStorefrontFile(fileName: string): string {
  const filePath = join(storefrontDir, fileName);

  if (!existsSync(filePath)) {
    throw new Error(
      `Missing storefront fixture ${fileName} in ${storefrontDir}. Run from the @baci/web test environment.`
    );
  }

  return readFileSync(filePath, 'utf8');
}

const CORE_SHEET_IMPORT =
  /@import\s+['"](\.\/storefront-core-[^'"]+\.css)['"]\s*;?/g;

export function readStorefrontCoreCss(): string {
  return inlineStorefrontCoreImports(readStorefrontFile('storefront-core.css'));
}

function inlineStorefrontCoreImports(source: string): string {
  return source.replace(CORE_SHEET_IMPORT, (_match, spec: string) => {
    const nested = readStorefrontFile(spec.slice(2));
    return `/* inlined ${spec} */\n${inlineStorefrontCoreImports(nested)}\n`;
  });
}

export function readStorefrontDarkModeCss(): string {
  return [
    readStorefrontFile('storefront-ogabassey-dark-mode.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-tokens.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-utilities.css'),
    readStorefrontFile('storefront-ogabassey-dark-mode-checkout-utilities.css'),
  ].join('\n');
}
