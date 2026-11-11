import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolvePackagedChromiumDirectory() {
  // Keep each fs path static so Next traces the archives only for entry
  // points that import the renderer, including /api/orders itself.
  const local = resolve(process.cwd(), 'node_modules/@sparticuz/chromium/bin');
  if (existsSync(local)) return local;
  const hoisted = resolve(
    process.cwd(),
    '../../node_modules/@sparticuz/chromium/bin'
  );
  if (existsSync(hoisted)) return hoisted;
  // Allow the external package to resolve its own directory in other layouts.
  return undefined;
}
