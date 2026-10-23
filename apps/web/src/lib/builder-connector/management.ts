import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { builderConnectionViewsSchema } from '@/schemas/builder-auth';
import type { Database } from '@/types/supabase';

export { builderConnectionViewsSchema };

/** RPC additions pending the release's regenerated complete database snapshot. */
type ManagementDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      list_builder_connections: {
        Args: Record<string, never>;
        Returns: z.infer<typeof builderConnectionViewsSchema>;
      };
      disconnect_builder_connection: {
        Args: { p_connection_id: string };
        Returns: boolean;
      };
    };
  };
};
async function ownerClient(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error('Sign in to manage Baci connections.');
  return client as unknown as SupabaseClient<ManagementDatabase>;
}
export async function listBuilderConnections(client: SupabaseClient<Database>) {
  const owner = await ownerClient(client);
  const { data, error } = await owner.rpc('list_builder_connections', {});
  if (error) throw new Error('Unable to load Baci connections.');
  return builderConnectionViewsSchema.parse(data);
}
export async function disconnectBuilderConnection(
  client: SupabaseClient<Database>,
  id: string
) {
  const connectionId = z.uuid().parse(id);
  const owner = await ownerClient(client);
  const { data, error } = await owner.rpc('disconnect_builder_connection', {
    p_connection_id: connectionId,
  });
  if (error || data !== true)
    throw new Error('Unable to disconnect Baci connection.');
}
