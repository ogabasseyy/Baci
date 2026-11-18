import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { createPublicClient } from '@/lib/supabase/public';
import { cartNoticeHealthSchema } from '@/schemas/cart-notice-health';

const DELIVERY_FAULT_LOG_TAG = 'shared-cart notice_delivery_fault';

export async function runCartNoticeHealthCli(): Promise<number> {
  const supabase = createPublicClient({
    clientInfo: 'baci-cart-notice-health',
    timeoutMs: 10_000,
  });

  const result = await supabase.rpc('commerce_cart_publish_health');
  const parsed = cartNoticeHealthSchema.safeParse(result.data);

  if (result.error || !parsed.success) {
    logger.error({
      message: DELIVERY_FAULT_LOG_TAG,
      reason: result.error ? 'health_rpc_failed' : 'invalid_health_result',
      pgCode: result.error?.code,
    });
    return 1;
  }

  const health = parsed.data;
  const healthy =
    health.healthy &&
    health.staleUndelivered === 0 &&
    health.deadLettered24h === 0;

  if (!healthy) {
    logger.error({
      message: DELIVERY_FAULT_LOG_TAG,
      reason: 'notices_not_delivered',
      staleUndelivered: health.staleUndelivered,
      deadLettered24h: health.deadLettered24h,
    });
    console.error(
      JSON.stringify({
        healthy: false,
        staleUndelivered: health.staleUndelivered,
        deadLettered24h: health.deadLettered24h,
      })
    );
    return 1;
  }

  console.log(JSON.stringify({ healthy: true }));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runCartNoticeHealthCli()
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
