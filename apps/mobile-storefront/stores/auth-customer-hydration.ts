import type { User } from '@supabase/supabase-js';
import { splitFullName } from '../lib/auth-helpers';
import { isRestrictedSavingsSandbox } from '../lib/is-restricted-savings-sandbox';
import { createLogger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { CustomerRowSchema } from '../lib/validation';
import {
  CUSTOMER_SELECT_COLUMNS,
  isMissingUsernameChangedAtColumn,
  LEGACY_CUSTOMER_SELECT_COLUMNS,
} from './auth-customer-schema-compat';
import { getErrorMessage, initTimeout } from './auth-helpers';
import type { Customer } from './auth-store.types';

const log = createLogger('AuthHelpers');

type CustomerQueryError = { code?: string; message: string };
type CustomerQueryResult = { data: unknown; error: CustomerQueryError | null };

async function selectCustomer(
  merchantId: string,
  userId: string,
  columns: string,
  label: string,
  useTimeout: boolean
): Promise<CustomerQueryResult> {
  return (await wrapQuery(
    supabase
      .from('customers')
      .select(columns)
      .eq('merchant_id', merchantId)
      .eq('user_id', userId)
      .maybeSingle(),
    label,
    useTimeout
  )) as CustomerQueryResult;
}

async function selectCustomerWithSchemaFallback(
  merchantId: string,
  userId: string,
  label: string,
  useTimeout: boolean,
  preferredColumns = CUSTOMER_SELECT_COLUMNS
): Promise<CustomerQueryResult & { columns: string }> {
  let result = await selectCustomer(
    merchantId,
    userId,
    preferredColumns,
    label,
    useTimeout
  );
  if (
    preferredColumns === CUSTOMER_SELECT_COLUMNS &&
    isMissingUsernameChangedAtColumn(result.error)
  ) {
    result = await selectCustomer(
      merchantId,
      userId,
      LEGACY_CUSTOMER_SELECT_COLUMNS,
      `${label} (legacy schema)`,
      useTimeout
    );
    return { ...result, columns: LEGACY_CUSTOMER_SELECT_COLUMNS };
  }
  return { ...result, columns: preferredColumns };
}

/** Fetches, creates when necessary, and validates a merchant customer record. */
export async function hydrateCustomer({
  merchantId,
  user,
  useTimeout,
  initGen,
  getInitGen,
}: {
  merchantId: string;
  user: User;
  useTimeout: boolean;
  initGen?: number;
  getInitGen?: () => number;
}): Promise<Customer | null> {
  const cancelled = () =>
    initGen !== undefined && getInitGen && getInitGen() !== initGen;
  let customerQuery = await selectCustomerWithSchemaFallback(
    merchantId,
    user.id,
    'customer fetch',
    useTimeout
  );
  if (cancelled()) return null;
  if (customerQuery.error)
    log.error('Customer fetch failed:', customerQuery.error.message);

  let resolvedCustomer = customerQuery.data;
  if (!resolvedCustomer && user.email) {
    const { error: rpcError } = await wrapQuery(
      supabase.rpc('upsert_customer_on_auth', {
        p_merchant_id: merchantId,
        p_user_id: user.id,
        p_email: user.email,
        p_full_name: user.user_metadata?.full_name || null,
        p_phone: null,
      }),
      'customer upsert RPC',
      useTimeout
    );
    if (cancelled()) return null;
    if (rpcError) log.error('Customer upsert RPC failed:', rpcError.message);

    customerQuery = await selectCustomerWithSchemaFallback(
      merchantId,
      user.id,
      'customer re-fetch',
      useTimeout,
      customerQuery.columns
    );
    if (cancelled()) return null;
    if (customerQuery.error)
      log.error('Customer re-fetch failed:', customerQuery.error.message);
    resolvedCustomer = customerQuery.data;
  }

  let validatedCustomer = CustomerRowSchema.safeParse(resolvedCustomer);
  if (!validatedCustomer.success) return null;

  if (user.user_metadata && !isRestrictedSavingsSandbox()) {
    const { firstName, lastName } = splitFullName(user.user_metadata.full_name);
    const updates: Record<string, string> = {};
    if (!validatedCustomer.data.first_name && firstName)
      updates.first_name = firstName;
    if (!validatedCustomer.data.last_name && lastName)
      updates.last_name = lastName;

    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await wrapQuery(
        supabase
          .from('customers')
          .update(updates)
          .eq('id', validatedCustomer.data.id)
          .eq('merchant_id', merchantId)
          .select(customerQuery.columns)
          .single(),
        'customer profile backfill',
        useTimeout
      );
      if (cancelled()) return null;
      if (updateError)
        log.error('Customer backfill update failed:', updateError.message);
      else if (updated) {
        const updatedCustomer = CustomerRowSchema.safeParse(updated);
        if (updatedCustomer.success) validatedCustomer = updatedCustomer;
      }
    }
  }

  return {
    id: validatedCustomer.data.id,
    user_id: validatedCustomer.data.user_id,
    email: validatedCustomer.data.email,
    first_name: validatedCustomer.data.first_name ?? undefined,
    last_name: validatedCustomer.data.last_name ?? undefined,
    phone: validatedCustomer.data.phone ?? undefined,
    loyalty_points: validatedCustomer.data.loyalty_points ?? undefined,
    username: validatedCustomer.data.username ?? undefined,
    username_changed_at:
      validatedCustomer.data.username_changed_at ?? undefined,
    date_of_birth: validatedCustomer.data.date_of_birth ?? undefined,
  };
}

function wrapQuery<T>(
  query: PromiseLike<T>,
  label: string,
  useTimeout: boolean
): Promise<T> {
  if (!useTimeout) return Promise.resolve(query);
  return initTimeout(query, label).catch((error) => ({
    data: null,
    error: { message: getErrorMessage(error) },
  })) as Promise<T>;
}
