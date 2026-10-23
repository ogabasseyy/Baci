import type { NextRequest } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
/** Standard browser session only; no outer MCP token, admin client or cookie bypass. */
export async function publicationOwnerClient() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : client;
}
export async function checkPublicationMutation(request: Request) {
  const result = await checkCsrfProtection(request as NextRequest);
  return result.valid
    ? null
    : (result.response ??
        new Response('CSRF protection required', { status: 403 }));
}
