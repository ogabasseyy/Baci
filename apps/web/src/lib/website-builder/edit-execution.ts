import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { BuilderContext } from '@/lib/builder-connector/types';
import type { Database } from '@/types/supabase';

const bindingSchema = z
  .object({
    connectionId: z.uuid(),
    grantVersion: z.number().int().positive().safe(),
    merchantId: z.uuid(),
  })
  .strict();
export interface EditExecutionDependencies {
  authenticate: (
    token: string
  ) => Promise<{ actorUserId: string; client: SupabaseClient }>;
  execute: (ctx: BuilderContext, operationId: string) => Promise<unknown>;
}
export function createEditExecutionHandler(deps: EditExecutionDependencies) {
  return async (request: Request, operationId: string) => {
    const json = (error: string, status: number) =>
      Response.json(
        { error },
        { status, headers: { 'Cache-Control': 'no-store' } }
      );
    if (!z.uuid().safeParse(operationId).success || request.body !== null)
      return json('Invalid request', 400);
    const authorization = request.headers.get('authorization');
    if (
      !authorization ||
      !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization) ||
      authorization.length > 8192
    )
      return json('Unauthorized', 401);
    let auth: Awaited<ReturnType<EditExecutionDependencies['authenticate']>>;
    try {
      auth = await deps.authenticate(authorization.slice(7));
    } catch {
      return json('Unauthorized', 401);
    }
    try {
      const { data, error } = await auth.client.rpc(
        'builder_operation_context',
        { p_operation: operationId }
      );
      if (error) return json('Operation unavailable', 404);
      const binding = bindingSchema.parse(data);
      const ctx: BuilderContext = {
        merchantId: binding.merchantId,
        supabase: auth.client as SupabaseClient<Database>,
        identity: {
          actorUserId: auth.actorUserId,
          connectionId: binding.connectionId,
          grantVersion: binding.grantVersion,
          scopes: new Set(['storefront.read', 'storefront.write']),
          allowedMerchantIds: [binding.merchantId],
          allowCreateStore: false,
        },
      };
      await deps.execute(ctx, operationId);
      return Response.json(
        { status: 'accepted' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch {
      return json('Operation could not be completed. Read its status.', 409);
    }
  };
}
