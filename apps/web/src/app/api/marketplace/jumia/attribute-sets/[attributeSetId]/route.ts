import { type NextRequest, NextResponse } from 'next/server';
import { getAttributeSet } from '@/lib/jumia/catalog';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { authorizeJumiaMetadata } from '@/lib/jumia/metadata-request';
import { JumiaAttributeSetResponseSchema } from '@/schemas/jumia/catalog';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ attributeSetId: string }> }
) {
  try {
    const auth = await authorizeJumiaMetadata(request, true, context.params);
    if ('response' in auth) return auth.response;
    if (!auth.attributeSetId)
      return NextResponse.json(
        { error: 'Invalid attribute set ID' },
        { status: 400 }
      );
    const attributes = JumiaAttributeSetResponseSchema.parse(
      await getAttributeSet(auth.client, auth.attributeSetId)
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
