import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, it } from 'vitest';
import { mcpServerTestSupport } from './server-test-support';

it('quotes through the real MCP transport, anonymous catalog and GIG HTTP provider without booking or writes', async () => {
  const requests: string[] = [];
  let variantPolicy = 'off';
  let variantStock = 5;
  let parentManageStock: boolean | null = true;
  let simpleStrict = false;
  const shipmentBodies: Array<Record<string, unknown>> = [];
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push(`${req.method} ${url.pathname}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    res.setHeader('content-type', 'application/json');
    if (url.pathname.startsWith('/rest/')) {
      // The startup capability probe arrives with the worker JWT, not the
      // anon key: answer the cart-get RPC with the empty set.
      if (url.pathname === '/rest/v1/rpc/get_mcp_guest_cart' && (req.headers.authorization ?? '').startsWith('Bearer ')) { res.end('[]'); return; }
      if (req.headers.authorization !== 'Bearer test-anon-key') { res.writeHead(403).end('{}'); return; }
      if (url.pathname === '/rest/v1/merchants') res.end(JSON.stringify({ id: 'merchant-1' }));
      else if (url.pathname === '/rest/v1/rpc/resolve_storefront_public_snapshot_v2') res.end(JSON.stringify([{ resolution_status: 'found', merchant_data: { id: 'merchant-1', country: 'NG', payout_currency: 'NGN' }, feature_settings: { shipping_providers: ['gigl'] } }]));
      else if (url.pathname === '/rest/v1/rpc/get_storefront_shipping_sender') res.end(JSON.stringify({ business_name: 'Ogabassey', business_address: '2 Olaide Tomori Street, Ikeja, Lagos', state_code: 'LA', country: 'NG' }));
      else if (url.pathname === '/rest/v1/rpc/get_storefront_pdp_core_v2') {
        const { p_merchant_id, p_product_slug } = JSON.parse(body);
        expect(p_merchant_id).toBe('merchant-1');
        const product = p_product_slug === 'bfab9f45-7c2e-4744-be8e-9540af062406'
          ? { id: p_product_slug, name: 'Camera', price: 66700, weight_value: null, weight_unit: 'g', has_variants: false, has_condition_offers: false, manage_stock: true, stock_quantity: simpleStrict ? 0 : 5, product_variants: [] }
          : { id: p_product_slug, name: 'Phone fixture', price: 50000, weight_value: 1, weight_unit: 'kg', has_variants: true, has_condition_offers: false, manage_stock: parentManageStock, stock_quantity: 5, product_variants: [{ id: 'c985e013-7c2b-4655-a560-4085f27cd168', product_id: p_product_slug, price_override: 80000, stock_quantity: variantStock, inventory_tracking_policy: variantPolicy }] };
        res.end(JSON.stringify([{ resolution_status: 'found', product_data: { ...product, merchant_id: 'merchant-1', status: 'active', variants_truncated: false } }]));
      }
      // Anonymous RLS exposes no variant rows; the quote must use public RPCs.
      else if (url.pathname === '/rest/v1/product_variants') res.end('[]');
      else res.writeHead(404).end('{}');
      return;
    }
    let data: unknown;
    if (url.pathname === '/login') data = { 'access-token': 'fixture-token', UserChannelCode: 'fixture-channel', CustomerType: 0 };
    else if (url.pathname === '/localstations/get') data = [{ StationId: 4, StationName: 'IKEJA', City: 'Ikeja', StateName: 'Lagos', Address: 'Fixture station', Latitude: 6.6, Longitude: 3.3 }];
    else if (url.pathname === '/price/v3') { shipmentBodies.push(JSON.parse(body)); data = { GrandTotal: 1000 }; }
    else data = [];
    res.end(JSON.stringify({ status: 200, success: true, data }));
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let server: Awaited<ReturnType<typeof mcpServerTestSupport.startMcpServer>> | undefined;
  const client = new Client({ name: 'delivery-test', version: '1' });
  try {
    server = await mcpServerTestSupport.startMcpServer({ NEXT_PUBLIC_SUPABASE_URL: baseUrl, GIGL_ENABLED: 'true', GIGL_BASE_URL: baseUrl, GIGL_EMAIL: 'fixture@example.test', GIGL_PASSWORD: 'fixture-password' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`)));
    const result = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', delivery_preference: 'door', items: [{ product_id: 'bfab9f45-7c2e-4744-be8e-9540af062406', quantity: 2, weight_kg: 0.4 }] } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'quoted', fee: 1100, quote_available: true, quotes: [{ provider: 'GIGL', fee: 1100, delivery_type: 'door' }, { provider: 'GIGL', fee: 1100, delivery_type: 'door' }] });
    expect(shipmentBodies[0]).toMatchObject({ SenderStationId: 4, ReceiverStationId: 4, ShipmentItems: [{ ItemName: 'Camera', Value: 66700, Quantity: 2, Weight: 0.4 }] });
    const selectedVariant = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', delivery_preference: 'door', items: [{ product_id: '21d0d133-cd4b-43c0-b21e-b4610c524c50', variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168', quantity: 1 }] } });
    expect(selectedVariant.structuredContent).toMatchObject({ status: 'quoted', fee: 1100 });
    expect(shipmentBodies.at(-1)).toMatchObject({ ShipmentItems: [{ ItemName: 'Phone fixture', Value: 80000, Quantity: 1, Weight: 1 }] });
    variantPolicy = 'serialized_strict';
    variantStock = 0;
    parentManageStock = false;
    const pricedBeforeStrict = shipmentBodies.length;
    const depleted = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', items: [{ product_id: '21d0d133-cd4b-43c0-b21e-b4610c524c50', variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168', quantity: 1 }] } });
    expect(depleted.structuredContent).toMatchObject({ status: 'unavailable', quote_available: false });
    expect(shipmentBodies).toHaveLength(pricedBeforeStrict);
    variantStock = 1;
    const aggregate = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', items: Array.from({ length: 2 }, () => ({ product_id: '21d0d133-cd4b-43c0-b21e-b4610c524c50', variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168', quantity: 1 })) } });
    expect(aggregate.structuredContent).toMatchObject({ status: 'unavailable' });
    expect(shipmentBodies).toHaveLength(pricedBeforeStrict);
    variantPolicy = 'serialized_then_unlimited';
    variantStock = 0;
    const unlimited = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', items: [{ product_id: '21d0d133-cd4b-43c0-b21e-b4610c524c50', variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168', quantity: 2 }] } });
    expect(unlimited.structuredContent).toMatchObject({ status: 'quoted' });
    variantPolicy = 'off';
    parentManageStock = null;
    const pricedBeforeNull = shipmentBodies.length;
    const nullPolicy = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', items: [{ product_id: '21d0d133-cd4b-43c0-b21e-b4610c524c50', variant_id: 'c985e013-7c2b-4655-a560-4085f27cd168', quantity: 1 }] } });
    expect(nullPolicy.structuredContent).toMatchObject({ status: 'unavailable' });
    simpleStrict = true;
    const simpleAnchor = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Lagos', city: 'Ikeja', items: [{ product_id: 'bfab9f45-7c2e-4744-be8e-9540af062406', quantity: 1, weight_kg: 0.4 }] } });
    expect(simpleAnchor.structuredContent).toMatchObject({ status: 'unavailable' });
    expect(shipmentBodies).toHaveLength(pricedBeforeNull);
    simpleStrict = false;
    const pricedBeforeMismatch = shipmentBodies.length;
    const mismatchedDestination = await client.callTool({ name: 'get_delivery_fee_info', arguments: { state: 'Rivers', city: 'Ikeja', items: [{ product_id: 'bfab9f45-7c2e-4744-be8e-9540af062406', quantity: 1, weight_kg: 0.4 }] } });
    expect(mismatchedDestination.structuredContent).toMatchObject({ status: 'unavailable', state: 'Rivers', fee: null, quote_available: false, quotes: [] });
    expect(shipmentBodies).toHaveLength(pricedBeforeMismatch);
    const allowedRequests = new Set([
      'GET /rest/v1/merchants',
      // Startup capability probe: one read-only cart-get before listening.
      'POST /rest/v1/rpc/get_mcp_guest_cart',
      'POST /rest/v1/rpc/resolve_storefront_public_snapshot_v2',
      'POST /rest/v1/rpc/get_storefront_shipping_sender',
      'POST /rest/v1/rpc/get_storefront_pdp_core_v2',
      'POST /login',
      'GET /localstations/get',
      'POST /price/v3',
    ]);
    expect(requests.filter((request) => !allowedRequests.has(request))).toEqual([]);
    expect(requests.filter((request) => request === 'POST /login')).toHaveLength(1);
    expect(requests.filter((request) => request === 'GET /localstations/get')).toHaveLength(1);
    expect(requests.filter((request) => request === 'POST /rest/v1/rpc/get_mcp_guest_cart')).toHaveLength(1);
  } finally {
    try {
      await client.close();
    } finally {
      try {
        if (server) await mcpServerTestSupport.stopMcpServer(server.process);
      } finally {
        await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
      }
    }
  }
}, 15000);
