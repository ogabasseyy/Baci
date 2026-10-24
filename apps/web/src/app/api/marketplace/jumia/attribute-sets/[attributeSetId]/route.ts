import { type NextRequest, NextResponse } from 'next/server';
import { getAttributeSet } from '@/lib/jumia/catalog';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { authorizeJumiaMetadata } from '@/lib/jumia/metadata-request';
import { JumiaAttributeSetResponseSchema } from '@/schemas/jumia/catalog';
import { jumiaAttributeSetParamSchema } from '@/schemas/jumia/metadata-query';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ attributeSetId: string }> }
) {
  const parsed = jumiaAttributeSetParamSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid attribute set ID' },
      { status: 400 }
    );
  try {
    const auth = await authorizeJumiaMetadata(request, true);
    if ('response' in auth) return auth.response;
    const attributes = JumiaAttributeSetResponseSchema.parse(
      await getAttributeSet(auth.client, parsed.data.attributeSetId)
    );
    return NextResponse.json(attributes);
  } catch (error) {
    return NextResponse.json(
      { error: 'Jumia attribute metadata unavailable' },
      {
        status:
          error instanceof JumiaApiError && error.status === 404 ? 404 : 502,
      }
    );
  }
}
