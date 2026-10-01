import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { buildNegotiationCustomerContact } from './negotiation-customer-contact';

export async function getNegotiationCustomerContact(phone: string) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && (!isAuthSessionMissingError(error) || user)) {
    throw error;
  }

  return buildNegotiationCustomerContact(user, phone);
}
