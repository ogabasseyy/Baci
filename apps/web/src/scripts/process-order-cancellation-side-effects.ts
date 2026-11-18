import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { processCancellationDrain } from '@/app/api/cron/process-settlements/process-cancellation-drain';
import { notifyMerchant } from '@/lib/expo-push';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/zeptomail';

export async function runOrderCancellationSideEffectsCli(): Promise<number> {
  const response = await processCancellationDrain(
    createServiceClient(),
    sendEmail,
    notifyMerchant
  );
  const body = await response.text();
  if (body) {
    console.log(body);
  }
  return response.status >= 400 ? 1 : 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runOrderCancellationSideEffectsCli()
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
