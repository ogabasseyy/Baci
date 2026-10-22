import { catalog, merchant } from '../../../../../fixtures';
export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (query.get('merchant_id') !== merchant.id)
    return Response.json({ error: 'Unknown fixture tenant' }, { status: 404 });
  return Response.json({
    products: catalog.products.map((product) => ({
      ...product,
      status: 'active',
    })),
  });
}
