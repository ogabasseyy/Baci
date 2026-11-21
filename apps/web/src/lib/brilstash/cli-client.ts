import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const tokenClaims = z.object({ role: z.string() });

// An unverified role is useful only to reject malformed or privileged
// configuration. Supabase verifies the access token before use.
function tokenRole(token: string): string | undefined {
  if (token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
    return undefined;
  try {
    const payload = token.split('.')[1];
    const claims = tokenClaims.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    );
    return claims.success ? claims.data.role : undefined;
  } catch {
    return undefined;
  }
}

function resolveBrilStashToolConfiguration(
  env: Record<string, string | undefined>
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const accessToken = env.BRILSTASH_TOOL_ACCESS_TOKEN;
  if (
    !url ||
    !publicKey ||
    !accessToken ||
    (!/^sb_publishable_[\w-]+$/.test(publicKey) &&
      (env.BRILSTASH_TOOL_TARGET !== 'local' ||
        tokenRole(publicKey) !== 'anon')) ||
    tokenRole(accessToken) !== 'authenticated'
  )
    return null;

  try {
    const parsed = new URL(url);
    if (env.BRILSTASH_TOOL_TARGET === 'local') {
      if (
        !['127.0.0.1', '[::1]'].includes(parsed.hostname) ||
        parsed.protocol !== 'http:' ||
        !parsed.port ||
        parsed.href !== `http://${parsed.host}/`
      )
        return null;
    } else {
      const project = env.BRILSTASH_SUPABASE_PROJECT_REF;
      if (
        env.BRILSTASH_TOOL_TARGET !== 'hosted' ||
        !project ||
        !/^[a-z0-9]+$/.test(project) ||
        parsed.href !== `https://${project}.supabase.co/`
      )
        return null;
    }
  } catch {
    return null;
  }
  return { url, publicKey, accessToken };
}

export async function createBrilStashToolClient() {
  const config = resolveBrilStashToolConfiguration(process.env);
  if (!config) throw new Error('Invalid BrilStash CLI database configuration');
  const { url, publicKey, accessToken } = config;
  const client = createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  try {
    const result = await client.auth.getUser(accessToken);
    if (!result.error && result.data.user) return client;
  } catch {
    // Authentication errors may contain upstream request metadata.
  }
  throw new Error('BrilStash CLI authentication failed');
}
