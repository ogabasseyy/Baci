'use server';
import { revalidatePath } from 'next/cache';
import { BUILDER_ACCOUNT_LINKING_ENABLED } from '@/config/builder-linking';
import { disconnectBuilderConnection } from '@/lib/builder-connector/management';
import { createClient } from '@/lib/supabase/server';
import { builderDisconnectInputSchema } from '@/schemas/builder-auth';
/** Next Server Actions enforce same-origin POSTs; normal session + RLS owns the RPC. */
export async function disconnectBuilderAction(form: FormData) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error('Sign in to manage Baci connections.');
  if (!BUILDER_ACCOUNT_LINKING_ENABLED)
    throw new Error('Baci ChatGPT linking is not enabled.');
  const { connectionId } = builderDisconnectInputSchema.parse({
    connectionId: form.get('connectionId'),
  });
  await disconnectBuilderConnection(client, connectionId);
  revalidatePath('/dashboard/integrations/chatgpt');
}
