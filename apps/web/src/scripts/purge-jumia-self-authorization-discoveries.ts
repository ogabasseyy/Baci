import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { purgeExpiredJumiaSelfAuthorizationDiscoveries } from '@/lib/jumia/purge-expired-jumia-self-authorization-discoveries';
import { createAdminClient } from '@/lib/supabase/admin';

export async function runPurgeJumiaSelfAuthorizationDiscoveriesCli(): Promise<number> {
  const deleted = await purgeExpiredJumiaSelfAuthorizationDiscoveries(
    createAdminClient()
  );
  console.log(JSON.stringify({ deleted }));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runPurgeJumiaSelfAuthorizationDiscoveriesCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error
      );
      process.exitCode = 1;
    });
}
