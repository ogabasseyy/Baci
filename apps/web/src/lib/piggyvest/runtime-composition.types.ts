import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';
import type { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import type { createSavingsExitExecution } from './savings-exit-execution';

export type RuntimeCompositionCommon = Parameters<
  typeof createPiggyvestCustomerScreenRuntime
>[0];
export type RuntimeCompositionServices = {
  prefundedCard?: {
    enabled: true;
    expectedSystemId: string;
    execute: PiggyvestProvisioningExecutor;
  };
  funding?: Omit<
    Parameters<typeof createPiggyvestCustomerFundingScreen>[0],
    keyof RuntimeCompositionCommon
  >;
  purchase?: { enabled: true; paymentLegRecovery?: { enabled: true } };
  exitExecution?: {
    enabled: true;
    policies?: { purchase?: unknown; cancellation?: unknown };
    transferProvider: Parameters<
      typeof createSavingsExitExecution
    >[0]['transferProvider'];
  };
  lifecycle?: { enabled: true };
  schedule?: { enabled: true };
  closure?: { enabled: true };
  protectedOffer?: { enabled: true };
  reconciliation?: { enabled: true };
  periodRecovery?: { enabled: true };
  deviceChange?: { enabled: true; termsDocument: unknown };
};
export interface RuntimeCompositionOptions {
  origin: string;
  browserOrigin?: string;
  csrfCookiePath?: string;
  csrfSecret?: Uint8Array;
  configuration: unknown;
  createRlsClient?: (request: NextRequest) => Promise<SupabaseClient>;
  authentication?: unknown;
  authenticationFetch?: typeof fetch;
  execute: PiggyvestProvisioningExecutor;
  services?: RuntimeCompositionServices;
}
