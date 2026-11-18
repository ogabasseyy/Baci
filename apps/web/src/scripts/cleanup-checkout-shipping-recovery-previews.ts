import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createAdminClient } from '@/lib/supabase/admin';

export async function runCleanupCheckoutShippingRecoveryPreviewsCli(): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(
    'cleanup_customer_checkout_shipping_recovery_previews' as never,
    { p_limit: 1000 } as never
  );

  if (error) {
    throw new Error(
      `Failed to clean up checkout shipping recovery previews: ${error.message}`
    );
  }

  console.log(JSON.stringify({ purged: data ?? 0 }));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runCleanupCheckoutShippingRecoveryPreviewsCli()
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
