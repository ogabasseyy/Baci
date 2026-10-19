import { logger } from '@/lib/logger';

const KUDA_DEBUG_SERVICE_TYPES = new Set(['ADMIN_PURCHASE_BILL', 'BILL_TSQ']);

function readKudaBillDebugFlag(): string {
  // Browser runtimes never enable bill debug (mirrors
  // getKudaBillDebug; server-route tests run in jsdom, so
  // NODE_ENV=test counts as server, matching isBrowserRuntime).
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    return '';
  }
  // Read directly instead of via @/env: env.ts is the credential
  // authority (service-role key), and routing this debug flag
  // through it drags every Kuda consumer into its import graph,
  // tripping the event-pipeline boundary contract for any new file
  // touching Kuda. getEnv() derives KUDA_BILL_DEBUG from this same
  // variable, so the validated-env fallback adds nothing.
  return (process.env.KUDA_BILL_DEBUG ?? '').trim();
}

export function isKudaBillDebugEnabled() {
  const value = readKudaBillDebugFlag().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Fixed-metadata Kuda response marker (Codex R98 P1). An earlier
 * revision logged the redacted raw provider body; redacting
 * selected keys does not satisfy the VTU exception's absolute
 * prohibition on provider response bodies entering logs, so this
 * records only the routing metadata — never request or response
 * payloads. Do not add payload fields back.
 */
export function logKudaResponse({
  requestRef,
  serviceType,
}: {
  requestRef: string;
  serviceType: string;
}) {
  if (!isKudaBillDebugEnabled() || !KUDA_DEBUG_SERVICE_TYPES.has(serviceType)) {
    return;
  }

  logger.info({
    message: 'Kuda response received',
    requestRef,
    serviceType,
  });
}
