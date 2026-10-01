import {
  normalizeNegotiationCustomerEmail,
  normalizeStoredE164Phone,
} from '@baci/shared/lib';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

export interface NegotiationCustomerClient {
  auth: {
    getUser: () => Promise<{
      data: {
        user: {
          email?: string | null;
          id: string;
          phone?: string | null;
        } | null;
      };
      error: unknown;
    }>;
  };
}

export interface NegotiationCustomerSession {
  customerEmail: string | null;
  customerId: string | null;
  customerPhone: string | null;
}

export async function resolveNegotiationCustomer(
  supabase: NegotiationCustomerClient
): Promise<NegotiationCustomerSession> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && (!isAuthSessionMissingError(error) || user)) {
    throw error;
  }

  return {
    customerEmail: normalizeNegotiationCustomerEmail(user?.email),
    customerId: user?.id ?? null,
    customerPhone: normalizeStoredE164Phone(user?.phone),
  };
}
