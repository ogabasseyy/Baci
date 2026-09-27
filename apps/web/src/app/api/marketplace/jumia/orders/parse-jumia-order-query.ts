import { jumiaOrderQuerySchema } from '@/schemas/jumia/order-query';

export function parseJumiaOrderQuery(searchParams: URLSearchParams) {
  return jumiaOrderQuerySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
    status: searchParams.get('status') || undefined,
    integrationId: searchParams.get('integrationId') || undefined,
  });
}
