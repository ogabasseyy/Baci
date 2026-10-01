type PublicSupabaseEnvironment = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

/**
 * Reads the only two public credentials needed by server-side session
 * validation. This intentionally stays independent from the broad env module
 * so request authentication never loads unrelated provider configuration.
 */
export function getSupabaseAuthRuntimeConfig(
  environment: PublicSupabaseEnvironment = {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }
): { anonKey: string; url: string } {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error('Supabase configuration is missing');
  }
  return { anonKey, url };
}
