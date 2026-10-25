import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { reconcileOxygenCallbackPayment } from './callback-payment-recovery';
import { createOxygenPaymentRecoveryRecorder } from './payment-recovery-evidence';
import { createOxygenProvider } from './provider';
import { createOxygenResponseRecorder } from './response-evidence';
import { loginOxygenPartner } from './transport';
import type { OxygenCallbackConfiguration } from './webhook-receiver';

/** Runtime secrets are injected by the host, never by a checkout request.
 * A normal Auth worker identity also needs an explicit enabled database binding. */
export function connectOxygenRuntime() {
  if (process.env.VERCEL_ENV === 'production') return null;
  const reference = process.env.OXYGEN_STAGING_PARTNER_REFERENCE;
  const secret = process.env.OXYGEN_STAGING_PARTNER_SECRET;
  const email = process.env.OXYGEN_STAGING_WORKER_EMAIL;
  const password = process.env.OXYGEN_STAGING_WORKER_PASSWORD;
  const hostedHosts = process.env.OXYGEN_STAGING_HOSTED_HOSTS?.split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (!reference || !secret || !email || !password || !hostedHosts?.length)
    return null;
  const evidenceKey = process.env.OXYGEN_DRAFT_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(evidenceKey)) return null;
  const hosts = new Set([...hostedHosts, 'payment.hydrogenpay.com']);
  let login: ReturnType<typeof loginOxygenPartner> | undefined;
  const providerDeps = {
    fetch,
    redactionSecrets: [reference, secret],
    token: async () => {
      login ??= loginOxygenPartner(
        { fetchImpl: fetch },
        {
          baseUrl: 'https://staging-api.theoxygen.com/services/partners',
          reference,
          secret,
        }
      );
      return (await login).token;
    },
  };
  const provider = {
    ...createOxygenProvider(providerDeps),
    forCommand: (
      worker: import('./runtime-service').OxygenRuntimeRpc,
      workflowId: string,
      commandId: string
    ) =>
      createOxygenProvider({
        ...providerDeps,
        observe: createOxygenResponseRecorder(
          worker,
          workflowId,
          commandId,
          evidenceKey,
          hosts
        ),
      }),
  };
  return {
    provider,
    activationTrialRequest: async (
      operation: import('./activation-trial').OxygenActivationTrialOperation
    ) => {
      if (!['payment', 'activate'].includes(operation))
        throw new Error('Unsupported trial operation');
      const path =
        operation === 'payment'
          ? 'split-payment-setup/confirmation'
          : 'activate-loan';
      return fetch(
        `https://staging-api.theoxygen.com/services/partners/v1/partner-loans/${path}`,
        {
          method: 'POST',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${await providerDeps.token()}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            loan_reference: '438f96ee-37c4-49bb-a56c-51451f9cb624',
          }),
        }
      );
    },
    recoveryProvider: (
      observe: (
        response: import('./response-evidence').OxygenObservedResponse
      ) => Promise<void>
    ) => createOxygenProvider({ ...providerDeps, observe }),
    reconcilePaymentCallback: (
      worker: import('./runtime-service').OxygenRuntimeRpc,
      workflow: string,
      callbackId: string,
      retryKey: string
    ) =>
      reconcileOxygenCallbackPayment(
        worker,
        (command) =>
          createOxygenProvider({
            ...providerDeps,
            observe: createOxygenPaymentRecoveryRecorder(
              worker,
              workflow,
              command,
              evidenceKey,
              hosts
            ),
          }),
        workflow,
        callbackId,
        retryKey
      ),
    partnerReference: reference,
    hosts,
    worker: async () => {
      // Fresh, non-admin client; do not mutate the globally cached anonymous client.
      const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error('Workflow unavailable');
      return client;
    },
  };
}
export function oxygenRuntimeCallbackConfiguration(): OxygenCallbackConfiguration | null {
  const partnerReference = process.env.OXYGEN_STAGING_PARTNER_REFERENCE;
  const apiKey = process.env.OXYGEN_STAGING_CALLBACK_KEY;
  const apiSecret = process.env.OXYGEN_STAGING_CALLBACK_SECRET;
  if (!partnerReference || !apiKey || !apiSecret) return null;
  return { partnerReference, auth: { mode: 'API_KEY', apiKey, apiSecret } };
}
