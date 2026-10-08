import { cleanUsername } from '@/schemas/username';
import { supabase } from '../lib/supabase';
import { CustomerRowSchema } from '../lib/validation';
import { CUSTOMER_SELECT_COLUMNS } from './auth-customer-schema-compat';
import type { AuthStoreGet, AuthStoreSet, Customer } from './auth-store.types';
import {
  getUsernameCooldownNextEligibleAt,
  getUsernamePolicyError,
  parseUsernameWriteResult,
} from './auth-username-policy';
import { getProfileUpdateError } from './profile-update-error';

type AccountIdentity = {
  merchantId: string;
  userId: string | null;
  customerId: string | null;
};

function captureAccountIdentity(
  state: ReturnType<AuthStoreGet>,
  merchantId: string,
  customer: Customer | null
): AccountIdentity {
  return {
    merchantId,
    userId: state.user?.id ?? state.customer?.user_id ?? null,
    customerId: customer?.id ?? null,
  };
}

function isSameInitiatingAccount(
  identity: AccountIdentity,
  state: ReturnType<AuthStoreGet>
) {
  if (state.merchantId !== identity.merchantId) return false;
  const currentUserId = state.user?.id ?? state.customer?.user_id ?? null;
  if (identity.userId && currentUserId !== identity.userId) return false;
  return !(
    identity.customerId &&
    state.customer &&
    state.customer.id !== identity.customerId
  );
}

export function createProfileActions(set: AuthStoreSet, get: AuthStoreGet) {
  return {
    updateProfile: async (data: Partial<Customer>) => {
      try {
        const initialState = get();
        const { customer, merchantId } = initialState;
        if (!customer || !merchantId)
          return { success: false, error: 'Not logged in' };
        const initiatingAccount = captureAccountIdentity(
          initialState,
          merchantId,
          customer
        );

        const {
          data: { user: verifiedUser },
          error: authError,
        } = await supabase.auth.getUser();
        if (
          authError ||
          !verifiedUser ||
          (initiatingAccount.userId &&
            verifiedUser.id !== initiatingAccount.userId)
        ) {
          return {
            success: false,
            error: 'Session expired. Please sign in again.',
          };
        }

        const updates = Object.fromEntries(
          Object.entries({
            first_name: data.first_name,
            last_name: data.last_name,
            phone: data.phone,
          }).filter(([, value]) => value !== undefined)
        );
        if (Object.keys(updates).length === 0) return { success: true };

        const { data: updated, error } = await supabase
          .from('customers')
          .update(updates)
          .eq('id', customer.id)
          .eq('merchant_id', merchantId)
          .select(CUSTOMER_SELECT_COLUMNS)
          .single();
        if (error)
          return { success: false, error: getProfileUpdateError(error) };

        const updateValidation = CustomerRowSchema.safeParse(updated);
        if (!updateValidation.success) {
          return { success: false, error: 'Invalid data received from server' };
        }
        if (!isSameInitiatingAccount(initiatingAccount, get()))
          return { success: true };

        const liveCustomer = get().customer;
        const nextCustomer: Customer = {
          id: updateValidation.data.id,
          user_id: updateValidation.data.user_id,
          email: updateValidation.data.email,
          first_name: updateValidation.data.first_name ?? undefined,
          last_name: updateValidation.data.last_name ?? undefined,
          phone: updateValidation.data.phone ?? undefined,
          loyalty_points: updateValidation.data.loyalty_points ?? undefined,
          username:
            liveCustomer?.username ??
            updateValidation.data.username ??
            undefined,
          username_changed_at:
            liveCustomer?.username_changed_at ??
            updateValidation.data.username_changed_at ??
            undefined,
          username_next_eligible_at:
            liveCustomer?.username_next_eligible_at ?? undefined,
          date_of_birth:
            liveCustomer?.date_of_birth ??
            updateValidation.data.date_of_birth ??
            undefined,
        };
        set({ customer: nextCustomer });
        return { success: true };
      } catch (error) {
        return { success: false, error: getProfileUpdateError(error) };
      }
    },
    setUsername: async (username: string) => {
      try {
        const initialState = get();
        const { merchantId } = initialState;
        if (!merchantId) return { success: false, error: 'Not logged in' };
        const initiatingAccount = captureAccountIdentity(
          initialState,
          merchantId,
          initialState.customer
        );

        const {
          data: { user: verifiedUser },
          error: authError,
        } = await supabase.auth.getUser();
        if (
          authError ||
          !verifiedUser ||
          (initiatingAccount.userId &&
            verifiedUser.id !== initiatingAccount.userId)
        ) {
          return {
            success: false,
            error: 'Session expired. Please sign in again.',
          };
        }

        const { data, error } = await supabase.rpc('set_customer_username_v2', {
          p_merchant_id: merchantId,
          p_username: cleanUsername(username),
        });
        if (error) {
          const nextEligibleAt = getUsernameCooldownNextEligibleAt(error);
          const latestCustomer = get().customer;
          if (
            nextEligibleAt &&
            latestCustomer &&
            isSameInitiatingAccount(initiatingAccount, get())
          ) {
            set({
              customer: {
                ...latestCustomer,
                username_next_eligible_at: nextEligibleAt,
              },
            });
          }
          return { success: false, error: getUsernamePolicyError(error) };
        }

        const result = parseUsernameWriteResult(data);
        if (!result)
          return { success: false, error: 'Invalid data received from server' };
        const latestCustomer = get().customer;
        if (
          latestCustomer &&
          isSameInitiatingAccount(initiatingAccount, get())
        ) {
          set({
            customer: {
              ...latestCustomer,
              username: result.username,
              username_changed_at: result.usernameChangedAt,
              username_next_eligible_at: result.nextEligibleAt,
            },
          });
        }
        return { success: true, username: result.username };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not set username';
        return { success: false, error: message };
      }
    },
  };
}
