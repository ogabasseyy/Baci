import { describe, expect, it } from 'vitest';
import { createStorefrontEdgeApiRows } from './create-storefront-edge-api-rows';

const apiRoot = 'apps/web/src/app/api';

describe('createStorefrontEdgeApiRows', () => {
  it('enumerates exact API handler patterns and their exported methods', () => {
    // Arrange
    const apiSources = [
      {
        bytes: Buffer.from(
          'export async function GET() {}\nexport async function PATCH() {}\n'
        ),
        sourcePath: `${apiRoot}/orders/[id]/route.ts`,
      },
      {
        bytes: Buffer.from("export { handler as POST } from './handler';\n"),
        sourcePath: `${apiRoot}/events/route.ts`,
      },
      {
        bytes: Buffer.from('export async function POST() {}\n'),
        sourcePath: `${apiRoot}/webhooks/[...provider]/route.ts`,
      },
      {
        bytes: Buffer.from('export async function GET() {}\n'),
        sourcePath: `${apiRoot}/archive/[[...path]]/route.ts`,
      },
      {
        bytes: Buffer.from('export async function GET() {}\n'),
        sourcePath: `${apiRoot}/route.ts`,
      },
      {
        bytes: Buffer.from('export async function POST() {}\n'),
        sourcePath: `${apiRoot}/orders/reuse/route.ts`,
      },
    ];

    // Act
    const rows = createStorefrontEdgeApiRows(apiRoot, apiSources);

    // Assert
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          methods: ['GET', 'HEAD', 'OPTIONS', 'PATCH'],
          routePattern: '/api/orders/{id}',
        }),
        expect.objectContaining({
          methods: ['OPTIONS', 'POST'],
          routePattern: '/api/events',
        }),
        expect.objectContaining({
          methods: ['OPTIONS', 'POST'],
          routePattern: '/api/webhooks/{*provider}',
        }),
        expect.objectContaining({
          methods: ['GET', 'HEAD', 'OPTIONS'],
          routePattern: '/api/archive/{*path?}',
        }),
        expect.objectContaining({
          methods: ['GET', 'HEAD', 'OPTIONS'],
          routePattern: '/api',
        }),
      ])
    );
    expect(rows).toHaveLength(6);
    expect(
      rows.findIndex(({ routePattern }) => routePattern === '/api/orders/reuse')
    ).toBeLessThan(
      rows.findIndex(({ routePattern }) => routePattern === '/api/orders/{id}')
    );
  });

  it('rejects an API handler without an exported HTTP method', () => {
    // Arrange
    const apiSources = [
      {
        bytes: Buffer.from("export const runtime = 'nodejs';\n"),
        sourcePath: `${apiRoot}/invalid/route.ts`,
      },
    ];

    // Act and assert
    expect(() => createStorefrontEdgeApiRows(apiRoot, apiSources)).toThrow(
      `storefront API route exports no HTTP method: ${apiRoot}/invalid/route.ts`
    );
  });

  it('admits TypeScript JSX route handlers (.tsx)', () => {
    const rows = createStorefrontEdgeApiRows(apiRoot, [
      {
        bytes: Buffer.from('export async function GET() {}\n'),
        sourcePath: `${apiRoot}/cart/validate/route.tsx`,
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'api-route:cart/validate/route.tsx',
        methods: ['GET', 'HEAD', 'OPTIONS'],
        routePattern: '/api/cart/validate',
        sourcePath: `${apiRoot}/cart/validate/route.tsx`,
      }),
    ]);
  });
});
