import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UCP_FIXTURE_DIR } from './ucp-fixture-paths';

export function readUcpSchemaFile(file: string): unknown {
  return JSON.parse(readFileSync(join(UCP_FIXTURE_DIR, file), 'utf8'));
}
