import { existsSync, readFileSync } from 'node:fs';

export function loadResumableManifest(file, current, dryRun = false) {
  if (dryRun || !existsSync(file)) return current;
  const previous = JSON.parse(readFileSync(file, 'utf8'));
  return Object.keys(previous.runs ?? {}).length ? previous : current;
}
