import { type NextRequest, NextResponse } from 'next/server';
import { resolveJumiaConsignmentBusinessClientCode } from '@/app/api/marketplace/jumia/consignment/resolve-jumia-consignment-business-client-code';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { authorizeJumiaMetadata } from '@/lib/jumia/metadata-request';
import { JumiaShopSchema } from '@/schemas/jumia/shops';

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeJumiaMetadata(request, true);
    if ('response' in auth) return auth.response;
    const client = auth.client;
    if (!client.shopId || client.shopId === 'oauth')
      return NextResponse.json(
        {
          error:
            'Reconnect Jumia with an exact shop before mapping destinations',
        },
        { status: 409 }
      );
    const shops = JumiaShopSchema.array().parse(await client.getShops());
    const matches = shops.filter((shop) => shop.id === client.shopId);
    if (matches.length !== 1)
      return NextResponse.json(
        { error: 'Connected Jumia shop could not be verified' },
        { status: 409 }
      );
    const businessClients = matches[0].businessClients
      .filter(
        (item) =>
          item.status === 'active' &&
          resolveJumiaConsignmentBusinessClientCode(
            client.marketplaceKey,
            item.code
          ).ok
      )
      .map(({ code, name, countryCode }) => ({ code, name, countryCode }));
    if (
      new Set(businessClients.map((item) => item.code)).size !==
      businessClients.length
    )
      return NextResponse.json(
        { error: 'Ambiguous Jumia destinations; reconnect before mapping' },
        { status: 409 }
      );
    return NextResponse.json({ businessClients });
  } catch (error) {
    return NextResponse.json(
      { error: 'Jumia destinations unavailable' },
      {
        status:
          error instanceof JumiaApiError && error.status === 404 ? 404 : 502,
      }
    );
  }
}
