import type { SupabaseClient } from '@supabase/supabase-js';
import {
  builderFailureSchema,
  builderPublishResultSchema,
} from '@/schemas/builder-mcp-results';
import { storedPublicationSchema } from '@/schemas/builder-publication';
import { safeDatabaseFailure } from './mutation-authorization';
export async function publicationRpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {}
) {
  const { data, error } = await client.rpc(name, args);
  if (error) safeDatabaseFailure(error);
  return data as unknown;
}
export async function readStoredPublication(
  client: SupabaseClient,
  intentId: string
) {
  return storedPublicationSchema.parse(
    await publicationRpc(client, 'builder_load_publication_intent', {
      p_intent: intentId,
    })
  );
}
export function publicationResult(value: unknown) {
  const failure = builderFailureSchema.safeParse(value);
  return failure.success
    ? failure.data
    : builderPublishResultSchema.parse(value);
}
