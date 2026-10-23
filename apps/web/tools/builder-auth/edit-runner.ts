import { z } from 'zod';

const uuid = z.uuid();
const connection = z.object({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion: z.number().int().positive().safe(),
  status: z.literal('active'),
  expiresAt: z.string(),
  allowedMerchantIds: z.array(uuid).max(1),
  scopes: z.array(z.string()),
  revokedAt: z.null(),
});
interface UserClient {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}
export interface EditRunnerDependencies {
  /** Private auth storage enumerates connection IDs only; it has no operation/content grants. */
  listConnections: (after: string | null, limit: number) => Promise<string[]>;
  readConnection: (id: string) => Promise<unknown>;
  resolveLinkedAccessToken: (identity: {
    connectionId: string;
    actorUserId: string;
    grantVersion: number;
  }) => Promise<string>;
  resolveUser: (
    token: string
  ) => Promise<{ actorUserId: string; client: UserClient }>;
  fetchImpl?: typeof fetch;
}
/** Explicit tick composition. Importing starts no loop, HTTP server or database connection. */
export function createLinkedEditRunner(deps: EditRunnerDependencies) {
  return {
    async runOnce(after: string | null = null) {
      if (after !== null) uuid.parse(after);
      const ids = z
        .array(uuid)
        .max(20)
        .parse(await deps.listConnections(after, 20));
      let executed = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const parsed = connection.safeParse(await deps.readConnection(id));
          if (
            !parsed.success ||
            parsed.data.connectionId !== id ||
            Date.parse(parsed.data.expiresAt) <= Date.now() ||
            !parsed.data.scopes.includes('storefront.write')
          )
            continue;
          const row = parsed.data;
          const token = await deps.resolveLinkedAccessToken(row);
          const user = await deps.resolveUser(token);
          if (user.actorUserId !== row.actorUserId)
            throw new Error('Reconnect');
          for (const merchantId of row.allowedMerchantIds) {
            const { data, error } = await user.client.rpc(
              'builder_list_due_edits',
              {
                p_connection: id,
                p_version: row.grantVersion,
                p_merchant: merchantId,
              }
            );
            if (error) throw new Error('Operation discovery unavailable');
            const operations = z.array(uuid).max(20).parse(data);
            for (const op of operations) {
              if (executed >= 20) break;
              const response = await (deps.fetchImpl ?? fetch)(
                `https://usebaci.com/api/integrations/chatgpt/builder-operations/${op}/run`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                  redirect: 'error',
                  signal: AbortSignal.timeout(35000),
                }
              );
              // No automatic HTTP retry. Lease expiry and canonical storage reconcile uncertain execution.
              if (!response.ok) throw new Error('Execution unavailable');
              await response.body?.cancel();
              executed++;
            }
          }
        } catch {
          failed++;
        }
      }
      return {
        cursor: ids.at(-1) ?? null,
        connections: ids.length,
        executed,
        failed,
      };
    },
  };
}
