import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UCP_FIXTURE_DIR } from './ucp-fixture-paths';

export function listUcpSchemaFiles(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.json') ? [path] : [];
    });
  return ['discovery', 'schemas']
    .flatMap((folder) => walk(join(UCP_FIXTURE_DIR, folder)))
    .map((path) => relative(UCP_FIXTURE_DIR, path).split('\\').join('/'))
    .sort();
}
