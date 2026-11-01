import { NextResponse } from 'next/server';
import {
  getAvailableImeiTierKeys,
  type ImeiCapabilitiesConfiguration,
} from '@/lib/imei-capabilities';
import { imeiCapabilitiesQuerySchema } from '@/schemas/imei-capabilities';

/** Public, non-money configuration discovery: no customer, merchant, database
 * or provider reads. All secret-bearing getters are injected by the route.
 */
export function createImeiCapabilitiesHandler(
  configuration: ImeiCapabilitiesConfiguration
) {
  return function GET(request: Request) {
    const search = new URL(request.url).searchParams;
    const headers = { 'Cache-Control': 'no-store' };
    const invalidQueryResponse = () =>
      NextResponse.json(
        {
          error: 'Invalid IMEI capability query',
          code: 'INVALID_REQUEST_QUERY',
        },
        { status: 400, headers }
      );
    const keys = [...new Set(search.keys())];
    // Zod deliberately ignores __proto__, so enforce the URL-key allowlist
    // before parsing rather than relying only on strict object validation.
    if (keys.some((key) => key !== 'device' && key !== 'clientCapabilities')) {
      return invalidQueryResponse();
    }
    // Preserve even prototype-named keys as own data properties so strict
    // validation rejects them rather than invoking Object.prototype setters.
    const query = Object.fromEntries(
      keys.map((key) => {
        const values = search.getAll(key);
        return [
          key,
          key === 'clientCapabilities' || values.length > 1
            ? values
            : values[0],
        ] as const;
      })
    );
    const parsed = imeiCapabilitiesQuerySchema.safeParse(query);
    if (!parsed.success) {
      return invalidQueryResponse();
    }
    return NextResponse.json(
      {
        availableTierKeys: getAvailableImeiTierKeys({
          configuration,
          ...parsed.data,
        }),
      },
      { headers }
    );
  };
}
