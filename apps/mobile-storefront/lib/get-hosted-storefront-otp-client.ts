import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { supabase } from './supabase';

export function getHostedStorefrontOtpClient(
  configuration = {
    hostedMode: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
    apiOrigin: EXPO_PUBLIC_API_URL,
    supabaseOrigin: process.env.EXPO_PUBLIC_SUPABASE_URL,
  }
): SupabaseClient['auth'] | null {
  if (
    typeof __DEV__ === 'undefined' ||
    !__DEV__ ||
    configuration.hostedMode !== '1'
  )
    return null;

  if (
    configuration.apiOrigin !== 'https://staging.ogabassey.com' ||
    configuration.supabaseOrigin !== 'https://staging-auth.ogabassey.com'
  )
    throw new Error('Hosted staging authentication is unavailable.');

  return supabase.auth;
}
