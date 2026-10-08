import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { z } from 'zod';
import { primaryWalletCardSchemas as schemas } from '@/schemas/primary-wallet-card';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';
import { supabase } from './supabase';

type Scope = z.infer<typeof schemas.scope>;
type Pending = z.infer<typeof schemas.pending>;
let queue: Promise<unknown> = Promise.resolve();

export function createPrimaryWalletCardFundingClient() {
  const key = (scope: Scope) =>
    `@baci_primary_card:${scope.merchantId}:${scope.userId}`;
  const serialize = <Result>(action: () => Promise<Result>) => {
    const result = queue.then(action);
    queue = result.catch(() => undefined);
    return result;
  };
  const read = async (scope: Scope) => {
    const raw = await AsyncStorage.getItem(key(scope));
    if (raw === null) return null;
    const record = schemas.pending.parse(JSON.parse(raw));
    if (
      record.userId !== scope.userId ||
      record.merchantId !== scope.merchantId
    )
      throw new Error('Card funding ownership could not be confirmed.');
    return record;
  };
  const write = async (record: Pending) => {
    const serialized = JSON.stringify(record);
    await AsyncStorage.setItem(key(record), serialized);
    if ((await AsyncStorage.getItem(key(record))) !== serialized)
      throw new Error(
        'Could not safely save card funding. No new payment was started.'
      );
  };
  const request = async (record: Pending) => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || user?.id !== record.userId)
      throw new Error(
        'Please sign in to the account that started this card funding operation.'
      );
    const initialize = record.operationId === null;
    const client = createStorefrontCustomerApiClient();
    const response = schemas.response.parse(
      await client.fetchJson({
        path: `/api/storefront/customer/wallet/primary-card/${initialize ? 'initialize' : 'status'}`,
        method: 'POST',
        includeCsrf: true,
        body: initialize
          ? {
              merchantId: record.merchantId,
              idempotencyKey: record.idempotencyKey,
              amountKobo: record.amountKobo,
              consent: record.consent,
            }
          : { merchantId: record.merchantId, operationId: record.operationId },
      })
    );
    if (
      response.amountKobo !== record.amountKobo ||
      (record.operationId !== null &&
        response.operationId !== record.operationId)
    )
      throw new Error(
        'Card funding could not be confirmed. Keep the pending operation for review.'
      );
    if (response.status === 'completed')
      await AsyncStorage.removeItem(key(record));
    else await write({ ...record, operationId: response.operationId });
    return { ...response, returnTo: record.returnTo };
  };
  return {
    readPending: (input: unknown) =>
      serialize(() => read(schemas.scope.parse(input))),
    start: (input: unknown) =>
      serialize(async () => {
        const parsed = schemas.start.parse(input);
        const scope = schemas.scope.parse({
          merchantId: parsed.merchantId,
          userId: parsed.userId,
        });
        let pending = await read(scope);
        if (
          pending &&
          (pending.amountKobo !== parsed.amountKobo ||
            JSON.stringify(pending.consent) !== JSON.stringify(parsed.consent))
        )
          throw new Error(
            'A different card funding operation is pending. Check its status before starting another.'
          );
        if (!pending) {
          pending = schemas.pending.parse({
            ...parsed,
            idempotencyKey: Crypto.randomUUID(),
            operationId: null,
          });
          await write(pending);
        }
        return request(pending);
      }),
    recover: (input: Scope & { reference?: string }) =>
      serialize(async () => {
        const scope = schemas.scope.parse({
          merchantId: input.merchantId,
          userId: input.userId,
        });
        const pending = await read(scope);
        if (!pending)
          throw new Error('No matching card funding operation was found.');
        if (
          input.reference &&
          (!pending.operationId ||
            input.reference !== `pvb-first-primary-${pending.operationId}`)
        )
          throw new Error(
            'The callback does not match this card funding operation.'
          );
        return request(pending);
      }),
  };
}
