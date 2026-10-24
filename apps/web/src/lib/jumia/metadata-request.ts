import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { JumiaClient } from '@/lib/jumia/client';
import {
  jumiaAttributeSetParamSchema,
  jumiaDestinationQuerySchema,
} from '@/schemas/jumia/metadata-query';
import { jumiaMerchantIdQuerySchema } from '@/schemas/marketplace';

export async function authorizeJumiaMetadata(
  request: NextRequest,
  requireExact: boolean,
  attributeSetParams?:
    | { attributeSetId: string }
    | Promise<{ attributeSetId: string }>
): Promise<
  { client: JumiaClient; attributeSetId?: string } | { response: NextResponse }
> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  const params = new URL(request.url).searchParams;
  const parsed = (
    requireExact ? jumiaDestinationQuerySchema : jumiaMerchantIdQuerySchema
  ).safeParse({
    merchantId: params.get('merchantId') ?? undefined,
    integrationId: params.get('integrationId') ?? undefined,
  });
  if (!parsed.success)
    return {
      response: NextResponse.json(
        { error: 'Invalid query parameters' },
        { status: 400 }
      ),
    };
  const parsedPath = attributeSetParams
    ? jumiaAttributeSetParamSchema.safeParse(await attributeSetParams)
    : undefined;
  if (parsedPath && !parsedPath.success)
    return {
      response: NextResponse.json(
        { error: 'Invalid attribute set ID' },
        { status: 400 }
      ),
    };
  const context = await getMerchantForApiRequest(auth.supabase, auth.user.id, {
    requestedMerchantId: parsed.data.merchantId,
  });
  if (
    !context ||
    (parsed.data.merchantId && context.merchantId !== parsed.data.merchantId) ||
    !hasPermission(toUserAccess(context), 'integrations', 'manage')
  ) {
    return {
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  const client = parsed.data.integrationId
    ? await JumiaClient.forIntegration(
        auth.supabase,
        context.merchantId,
        parsed.data.integrationId
      )
    : await JumiaClient.forMerchant(auth.supabase, context.merchantId);
  return parsedPath?.success
    ? { client, attributeSetId: parsedPath.data.attributeSetId }
    : { client };
}
