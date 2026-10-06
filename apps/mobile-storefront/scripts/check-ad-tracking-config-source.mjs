import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function readRequiredFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

/**
 * Reads the Expo app config source for ad-declaration extraction.
 *
 * Split-config fallback: app.config.ts may be a dispatcher that selects
 * the production builder below (which carries the ad declarations).
 * Concatenation preserves extraction (first quoted match wins) and is a
 * no-op on monolithic trees where the module does not exist.
 */
export function readAppConfigSourceWithSplitFallback(projectRoot) {
  const appConfigPath = path.join(projectRoot, 'app.config.ts');
  const productionConfigPath = path.join(
    projectRoot,
    'config',
    'development-storefront-expo-config-production.ts'
  );
  const appConfigSource = readRequiredFile(appConfigPath);
  if (!existsSync(productionConfigPath)) {
    return appConfigSource;
  }
  return `${appConfigSource}\n${readRequiredFile(productionConfigPath)}`;
}
