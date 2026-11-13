import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  getImeiDisabledTierKeys,
  getImeiHashSalt,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getSickwApiKey,
  isPetrockEnabled,
} from '@/env';
import { createImeiAccessClient } from '@/lib/imei-access';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readWalletPayRecoveryRuntime,
  readWalletPayRuntime,
} from '@/lib/piggyvest/wallet-pay-runtime';
import {
  checkWalletPayment,
  payFromWallet,
  refundWalletPayment,
  walletPayDelivery,
} from '@/lib/piggyvest/wallet-pay-service';
import { prepareImeiProvider } from '../prepare-imei-provider';
import type { ImeiLookupRow } from '../route-helpers';
import { deliverPaidImeiLookup } from './deliver-paid-imei-lookup';
import type { PayImeiWalletPaymentDeps } from './pay-imei-wallet-payment';

const providerConfiguration = {
  getImeiDisabledTierKeys,
  getImeiIdentifierEncryptionKey,
  getPetrockConfig,
  getPetrockEnabledTierKeys,
  getSickwApiKey,
  isPetrockEnabled,
};

/** Live wiring for the IMEI wallet-pay route (tests inject their own). */
export function createPayImeiWalletPaymentDeps(auth: {
  supabase: SupabaseClient;
  user: User;
}): PayImeiWalletPaymentDeps {
  const access = (identity: { merchantId: string; customerId: string }) =>
    createImeiAccessClient({
      customerId: identity.customerId,
      merchantId: identity.merchantId,
      supabase: auth.supabase,
      userId: auth.user.id,
    });
  return {
    readRuntime: readWalletPayRuntime,
    readRecoveryRuntime: readWalletPayRecoveryRuntime,
    resolveIdentity: (runtime) =>
      resolvePrimaryWalletIdentity({
        supabase: auth.supabase,
        user: auth.user,
        merchantId: runtime.merchantId,
        forOnboarding: false,
      }),
    hashSalt: getImeiHashSalt,
    readLookup: async (identity, lookupId) => {
      const { data, error } = await access(identity).readStatus(lookupId);
      if (error) throw new Error('IMEI lookup read failed');
      return (data as ImeiLookupRow | null) ?? null;
    },
    check: (input) => checkWalletPayment(input),
    pay: (input) => payFromWallet(input),
    deliver: async ({
      runtime,
      identity,
      lookup,
      operationId,
      normalizedImei,
      payment,
    }) => {
      const supabaseAdmin = access(identity);
      const delivery = walletPayDelivery(runtime);
      return await deliverPaidImeiLookup(
        { lookup, operationId, normalizedImei, supabaseAdmin, payment },
        {
          claim: delivery.claim,
          finish: delivery.finish,
          refund: (paymentId) => refundWalletPayment({ runtime, paymentId }),
          readStatus: async (lookupId) => {
            const { data, error } = await supabaseAdmin.readStatus(lookupId);
            if (error) throw new Error('IMEI lookup read failed');
            return (data as { status?: string } | null)?.status ?? null;
          },
          prepare: (row) =>
            prepareImeiProvider({
              access: supabaseAdmin,
              configuration: providerConfiguration,
              clientSupportsAsync: false,
              deviceCategory: row.device_category ?? undefined,
              requestedTier: row.tier,
            }) as never,
        }
      );
    },
  };
}
