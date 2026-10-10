import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { z } from 'zod';
import { primaryWalletCardSchemas as schemas } from '@/schemas/primary-wallet-card';
import { createLogger } from './logger';
import {
  isVerifiedEmailRequired,
  rollbackObservedCapabilityOnNotReady,
} from './piggyvest-primary-capability';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';
import { supabase } from './supabase';

type Scope = z.infer<typeof schemas.scope>;
type Pending = z.infer<typeof schemas.pending>;
// Per-scope queues: operations for one funding scope still serialize (so
// double taps share one initialization), but a slow call for one account
// can no longer head-of-line-block every other merchant/account app-wide.
const queues = new Map<string, Promise<unknown>>();
const log = createLogger('PrimaryWalletCard');

export function createPrimaryWalletCardFundingClient() {
  const key = (scope: Scope) =>
    `@baci_primary_card:${scope.merchantId}:${scope.userId}`;
  const serialize = <Result>(
    scopeKey: string,
    action: () => Promise<Result>
  ) => {
    const result = (queues.get(scopeKey) ?? Promise.resolve()).then(action);
    const tracked = result.then(
      () => {
        if (queues.get(scopeKey) === tracked) queues.delete(scopeKey);
      },
      () => {
        if (queues.get(scopeKey) === tracked) queues.delete(scopeKey);
      }
    );
    queues.set(scopeKey, tracked);
    return result;
  };
  const read = async (scope: Scope) => {
    const raw = await AsyncStorage.getItem(key(scope));
    if (raw === null) return null;
    let record: Pending;
    try {
      record = schemas.pending.parse(JSON.parse(raw));
    } catch {
      // A corrupt or schema-drifted record must never pin the scope:
      // drop it so the next attempt starts fresh with explicit consent
      // (a surviving server operation is re-adopted by initialize).
      // Ownership mismatches below are NOT dropped — that record belongs
      // to another account and must survive.
      // Redacted by construction: no record bytes or scope ids, so a
      // corrupt drop is distinguishable from no record during triage
      // without leaking funding data into logs.
      log.warn('Dropping a corrupt persisted card funding record.');
      await AsyncStorage.removeItem(key(scope));
      return null;
    }
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
    try {
      const initialize = record.operationId === null;
      const client = createStorefrontCustomerApiClient();
      const response = schemas.response.parse(
        await client.fetchJson({
          path: `/api/storefront/customer/wallet/primary-card/${initialize ? 'initialize' : 'status'}`,
          method: 'POST',
          includeCsrf: true,
          // Bind the token to the record owner inside the client's own
          // session read: the getUser check above cannot cover a switch
          // landing between it and this send, which would otherwise
          // reserve a checkout for the new account under the previous
          // account's stored record.
          expectedUserId: record.userId,
          body: initialize
            ? {
                merchantId: record.merchantId,
                idempotencyKey: record.idempotencyKey,
                amountKobo: record.amountKobo,
                consent: record.consent,
              }
            : {
                merchantId: record.merchantId,
                operationId: record.operationId,
              },
        })
      );
      // Adoption: when device storage was lost and the customer re-entered
      // a different amount or consent, the server returns its stored
      // unresolved operation instead of failing. Persist the stored
      // operation ID, amount, and save-card choice so the possibly charged
      // checkout stays recoverable, and flag it so the UI confirms the
      // adopted amount/consent before any payment. Status polls keep the
      // strict binding: a different operation or amount there is a real
      // inconsistency, not a recovery.
      const adopted =
        initialize &&
        (response.amountKobo !== record.amountKobo ||
          (response.saveCard !== undefined &&
            response.saveCard !== record.consent.saveCard));
      if (
        !adopted &&
        (response.amountKobo !== record.amountKobo ||
          (record.operationId !== null &&
            response.operationId !== record.operationId))
      )
        throw new Error(
          'Card funding could not be confirmed. Keep the pending operation for review.'
        );
      // Terminal states drop the saved record so a fresh operation can
      // start: an abandoned checkout can never complete, and keeping it
      // would pin every later funding attempt to the dead operation.
      if (response.status === 'completed' || response.status === 'abandoned')
        await AsyncStorage.removeItem(key(record));
      else
        await write(
          adopted
            ? {
                ...record,
                operationId: response.operationId,
                amountKobo: response.amountKobo,
                // The stored checkout runs under the server's consent, not
                // the just-entered one — persist it so later starts bind
                // against the effective choice. Absent echo (older server)
                // keeps the local consent: then only the amount adopted.
                consent: {
                  ...record.consent,
                  saveCard: response.saveCard ?? record.consent.saveCard,
                },
              }
            : { ...record, operationId: response.operationId }
        );
      return adopted
        ? { ...response, returnTo: record.returnTo, adopted: true as const }
        : { ...response, returnTo: record.returnTo };
    } catch (requestError) {
      // Authoritative not-ready — or the pre-reservation email 409 — means
      // the server reserved nothing, so a null-operation placeholder is
      // safe to drop: keeping it would let a later readPending initialize
      // a stale amount without fresh consent, or block the legacy
      // fallback by looking retained. Ambiguous failures keep the record
      // for recovery.
      if (
        (rollbackObservedCapabilityOnNotReady(
          record.merchantId,
          requestError
        ) ||
          isVerifiedEmailRequired(requestError)) &&
        record.operationId === null
      )
        await AsyncStorage.removeItem(key(record)).catch(() => undefined);
      throw requestError;
    }
  };
  return {
    readPending: (input: unknown) => {
      const scope = schemas.scope.parse(input);
      return serialize(key(scope), () => read(scope));
    },
    start: (input: unknown) => {
      const parsed = schemas.start.parse(input);
      const scope = schemas.scope.parse({
        merchantId: parsed.merchantId,
        userId: parsed.userId,
      });
      return serialize(key(scope), async () => {
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
      });
    },
    recover: (input: Scope & { reference?: string }) => {
      const scope = schemas.scope.parse({
        merchantId: input.merchantId,
        userId: input.userId,
      });
      return serialize(key(scope), async () => {
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
      });
    },
  };
}
