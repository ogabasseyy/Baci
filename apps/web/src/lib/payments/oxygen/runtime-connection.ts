import 'server-only';
import { z } from 'zod';
import {
  oxygenActivationBinding,
  oxygenActivationReferenceSchema,
  readOxygenActivationBindings,
} from './activation-binding';
import { reconcileOxygenCallbackPayment } from './callback-payment-recovery';
import { runGeneralOxygenActivation } from './general-activation';
import { completeOxygenPaidActivation } from './paid-activation';
import { createOxygenPaymentRecoveryRecorder } from './payment-recovery-evidence';
import { oxygenPhoneConfiguration } from './phone-handoff-configuration';
import { createOxygenProvider } from './provider';
import { createOxygenResponseRecorder } from './response-evidence';
import { readOxygenRuntimeConfiguration } from './runtime-configuration';
import { createOxygenWorkerClient } from './runtime-worker-client';
import { loginOxygenPartner } from './transport';
import type { OxygenCallbackConfiguration } from './webhook-receiver';

/** Runtime secrets are injected by the host, never by a checkout request.
 * A normal Auth worker identity also needs an explicit enabled database binding. */
export function connectOxygenRuntime() {
  const configuration = readOxygenRuntimeConfiguration();
  if (!configuration) return null;
  const {
    reference,
    secret,
    email,
    password,
    evidenceKey,
    hosts,
    baseUrl,
    environment,
  } = configuration;
  let cachedLogin: Awaited<ReturnType<typeof loginOxygenPartner>> | undefined;
  let pendingLogin: ReturnType<typeof loginOxygenPartner> | undefined;
  const providerDeps = {
    fetch,
    environment,
    redactionSecrets: [reference, secret],
    token: async () => {
      if (cachedLogin && Date.now() < cachedLogin.expiresAtMs - 30_000)
        return cachedLogin.token;
      pendingLogin ??= loginOxygenPartner(
        { fetchImpl: fetch },
        {
          baseUrl,
          reference,
          secret,
        }
      ).finally(() => {
        pendingLogin = undefined;
      });
      cachedLogin = await pendingLogin;
      return cachedLogin.token;
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
  const activationTrialRequest = async (
    operation: import('./activation-trial').OxygenActivationTrialOperation,
    bookingReference: string
  ) => {
    if (
      environment !== 'staging' ||
      !['payment', 'activate'].includes(operation)
    )
      throw new Error('Unsupported trial operation');
    oxygenActivationReferenceSchema.parse(bookingReference);
    if (!oxygenActivationBinding(bookingReference))
      throw new Error('Unsupported trial operation');
    const path =
      operation === 'payment'
        ? 'split-payment-setup/confirmation'
        : 'activate-loan';
    return fetch(`${baseUrl}/v1/partner-loans/${path}`, {
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
        loan_reference: bookingReference,
      }),
    });
  };
  const recoveryRecorder = (
    worker: import('./runtime-service').OxygenRuntimeRpc,
    workflow: string,
    command: string
  ) =>
    createOxygenPaymentRecoveryRecorder(
      worker,
      workflow,
      command,
      evidenceKey,
      hosts
    );
  const reconcilePaymentCallbackReadOnly = (
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
          observe: recoveryRecorder(worker, workflow, command),
        }),
      workflow,
      callbackId,
      retryKey
    );
  const activationConfirmed = async (
    worker: import('./runtime-service').OxygenRuntimeRpc,
    workflow: string
  ) => {
    const response = await worker.rpc('oxygen_runtime', {
      p_operation: 'worker_status',
      p_id: workflow,
      p_payload: {},
    });
    if (response.error) throw new Error('Workflow unavailable');
    const snapshot = z
      .object({
        environment: z.literal(environment),
        stage: z.string(),
        state: z.object({
          paymentComplete: z.boolean().optional(),
          setupComplete: z.boolean().optional(),
        }),
      })
      .parse(response.data);
    return (
      snapshot.stage === 'activated' &&
      snapshot.state.paymentComplete === true &&
      snapshot.state.setupComplete === true
    );
  };
  const completePaidActivation = async (
    worker: import('./runtime-service').OxygenRuntimeRpc,
    workflow: string
  ) => {
    if (
      environment === 'staging' &&
      readOxygenActivationBindings().some(
        (entry) => entry.workflowId === workflow
      )
    ) {
      if (environment !== 'staging') throw new Error('Activation unavailable');
      await completeOxygenPaidActivation(
        worker,
        workflow,
        activationTrialRequest,
        evidenceKey
      );
      return activationConfirmed(worker, workflow);
    }
    const prefix =
      environment === 'production' ? 'OXYGEN_PRODUCTION' : 'OXYGEN_STAGING';
    if (process.env[`${prefix}_AUTOMATIC_ACTIVATION_ENABLED`] !== 'true')
      return false;
    await runGeneralOxygenActivation(
      worker,
      workflow,
      environment,
      process.env[`${prefix}_AUTOMATIC_ACTIVATION_ENABLED`] === 'true',
      async (bookingReference) =>
        fetch(`${baseUrl}/v1/partner-loans/activate-loan`, {
          method: 'POST',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${await providerDeps.token()}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ loan_reference: bookingReference }),
        }),
      evidenceKey
    );
    return activationConfirmed(worker, workflow);
  };
  return {
    provider,
    environment,
    phoneConfiguration: oxygenPhoneConfiguration(environment, evidenceKey),
    activationTrialRequest,
    recoveryProvider: (
      observe: (
        response: import('./response-evidence').OxygenObservedResponse
      ) => Promise<void>
    ) => createOxygenProvider({ ...providerDeps, observe }),
    recoveryRecorder,
    completePaidActivation,
    reconcilePaymentCallbackReadOnly,
    reconcilePaymentCallback: async (
      worker: import('./runtime-service').OxygenRuntimeRpc,
      workflow: string,
      callbackId: string,
      retryKey: string
    ) => {
      if (await activationConfirmed(worker, workflow)) return;
      if (
        !(await reconcilePaymentCallbackReadOnly(
          worker,
          workflow,
          callbackId,
          retryKey
        ))
      )
        throw new Error('Payment remains unconfirmed');
      if (!(await completePaidActivation(worker, workflow)))
        throw new Error('Activation pending');
    },
    partnerReference: reference,
    hosts,
    worker: createOxygenWorkerClient(email, password),
  };
}
export function oxygenRuntimeCallbackConfiguration(): OxygenCallbackConfiguration | null {
  const production = process.env.VERCEL_ENV === 'production';
  if (production && process.env.OXYGEN_PRODUCTION_RUNTIME_ENABLED !== 'true')
    return null;
  const prefix = production ? 'OXYGEN_PRODUCTION' : 'OXYGEN_STAGING';
  const partnerReference = process.env[`${prefix}_PARTNER_REFERENCE`];
  const apiKey = process.env[`${prefix}_CALLBACK_KEY`];
  const apiSecret = process.env[`${prefix}_CALLBACK_SECRET`];
  if (!partnerReference || !apiKey || !apiSecret) return null;
  return { partnerReference, auth: { mode: 'API_KEY', apiKey, apiSecret } };
}
