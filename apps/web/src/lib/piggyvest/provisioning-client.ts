import 'server-only';
import { piggyvestProvisioningCommandSchema } from '@/schemas/piggyvest-provisioning-command';
import { piggyvestProvisioningConfigurationSchema } from '@/schemas/piggyvest-provisioning-configuration';
import { piggyvestProvisioningResponseSchemas } from '@/schemas/piggyvest-provisioning-response';
import { buildPiggyvestProvisioningRequest } from './provisioning-request';
import { createPiggyvestProvisioningStore } from './provisioning-store';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { requestPiggyvestStagingJson } from './staging-json-request';

type Result = {
  status:
    | 'not_ready'
    | 'storage_unavailable'
    | 'conflict'
    | 'already_dispatched'
    | 'not_claimed'
    | 'unknown'
    | 'existing_customer_unowned'
    | 'awaiting_confirmation';
  intentId?: string;
};

export async function provisionPiggyvestStagingResource({
  configuration,
  command,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  command: unknown;
  execute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
}): Promise<Result> {
  const config =
    piggyvestProvisioningConfigurationSchema.safeParse(configuration);
  if (
    !config.success ||
    typeof fetchImplementation !== 'function' ||
    typeof execute !== 'function'
  ) {
    return { status: 'not_ready' };
  }
  let request: ReturnType<typeof buildPiggyvestProvisioningRequest>;
  try {
    request = buildPiggyvestProvisioningRequest({ configuration, command });
  } catch {
    return { status: 'not_ready' };
  }
  const store = createPiggyvestProvisioningStore({
    configuration: {
      environment: config.data.environment,
      integrationId: config.data.integrationId,
      expectedMerchantId: config.data.expectedMerchantId,
      expectedBusinessId: config.data.expectedBusinessId,
    },
    execute,
  });
  let identity = {
    kind: request.kind,
    merchantId: request.merchantId,
    customerId: request.customerId,
    goalId: request.goalId,
    providerCustomerId: request.providerCustomerId,
    requestFingerprint: request.requestFingerprint,
  };
  let intentId: string;
  let claimToken: string;
  try {
    let prepared = await store.prepare(identity);
    const parsedCommand = piggyvestProvisioningCommandSchema.parse(command);
    if (
      prepared.outcome === 'conflict' &&
      parsedCommand.kind === 'create_plan_wallet' &&
      parsedCommand.customerName !== undefined
    ) {
      const legacyRequest = buildPiggyvestProvisioningRequest({
        configuration,
        command: { ...parsedCommand, customerName: undefined },
      });
      const legacyIdentity = {
        ...identity,
        requestFingerprint: legacyRequest.requestFingerprint,
      };
      const legacyPrepared = await store.prepare(legacyIdentity);
      if (
        legacyPrepared.outcome === 'duplicate' &&
        legacyPrepared.intentId === prepared.intentId
      ) {
        request = legacyRequest;
        identity = legacyIdentity;
        prepared = legacyPrepared;
      }
    }
    intentId = prepared.intentId;
    if (prepared.outcome === 'conflict')
      return { status: 'conflict', intentId };
    if (prepared.status !== 'pending') {
      return { status: 'already_dispatched', intentId };
    }
    const claimed = await store.claim(intentId, identity);
    if (!claimed) return { status: 'not_claimed', intentId };
    claimToken = claimed;
  } catch {
    return { status: 'storage_unavailable' };
  }
  let providerCustomerId: string | null = null;
  let providerWalletId: string | null = null;
  let resultCode: 'accepted' | 'ambiguous' = 'ambiguous';
  let existingCustomerUnowned = false;
  try {
    const response = await requestPiggyvestStagingJson({
      configuration: {
        apiBaseUrl: config.data.apiBaseUrl,
        apiSecret: config.data.apiSecret,
        expectedBusinessId: config.data.expectedBusinessId,
        expectedCurrency: config.data.expectedCurrency,
        timeoutMs: config.data.timeoutMs,
        maxResponseBytes: config.data.maxResponseBytes,
      },
      path: request.path,
      method: 'POST',
      body: request.body,
      fetchImplementation,
    });
    if (request.kind === 'create_customer') {
      const parsed =
        piggyvestProvisioningResponseSchemas.create_customer.safeParse(
          response
        );
      if (parsed.success && parsed.data.data.new_customer) {
        providerCustomerId = parsed.data.data.customer_id;
        providerWalletId = parsed.data.data.wallet_id;
        resultCode = 'accepted';
      } else if (parsed.success) {
        existingCustomerUnowned = true;
      }
    } else {
      const parsed =
        piggyvestProvisioningResponseSchemas.create_plan_wallet.safeParse(
          response
        );
      const requestedInterest =
        piggyvestProvisioningCommandSchema.parse(command).enableInterestAccrual;
      if (
        parsed.success &&
        !(requestedInterest && parsed.data.data.interest_enabled === false)
      ) {
        providerWalletId = parsed.data.data.id;
        providerCustomerId = request.providerCustomerId;
        resultCode = 'accepted';
      }
    }
  } catch {
    resultCode = 'ambiguous';
  }
  try {
    const recorded = await store.record({
      intentId,
      claimToken,
      resultCode,
      providerCustomerId,
      providerWalletId,
      ...(request.kind === 'create_customer' && resultCode === 'accepted'
        ? { newCustomer: true as const }
        : {}),
    });
    return {
      status:
        resultCode === 'accepted' && recorded === 'awaiting_confirmation'
          ? 'awaiting_confirmation'
          : existingCustomerUnowned && recorded === 'unknown'
            ? 'existing_customer_unowned'
            : 'unknown',
      intentId,
    };
  } catch {
    return { status: 'unknown', intentId };
  }
}
