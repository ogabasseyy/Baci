import { getAdminMerchantHealthPage } from '@/lib/admin-merchant-health';
import { getFirstSearchParam } from '@/lib/search-params';
import { createClient } from '@/lib/supabase/server';
import { adminMerchantsQuerySchema } from '@/schemas/admin-merchants-query';
import { MerchantsClient } from './merchants-client';

type MerchantsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MerchantsPage({
  searchParams,
}: MerchantsPageProps) {
  const params = await searchParams;
  const parsedQuery = adminMerchantsQuerySchema.safeParse({
    health: getFirstSearchParam(params.health) ?? undefined,
    limit: getFirstSearchParam(params.limit) ?? undefined,
    offset: getFirstSearchParam(params.offset) ?? undefined,
    search: getFirstSearchParam(params.search) ?? undefined,
    sortBy: getFirstSearchParam(params.sortBy) ?? undefined,
  });
  const initialQuery = parsedQuery.success
    ? parsedQuery.data
    : adminMerchantsQuerySchema.parse({});
  const supabase = await createClient();
  const { data, error, total } = await getAdminMerchantHealthPage(
    supabase,
    initialQuery
  );

  if (error) {
    console.error('Admin merchants initial load error:', error);
  }

  return (
    <MerchantsClient
      initialError={error ? 'Failed to load merchant data.' : null}
      initialMerchants={data ?? []}
      initialQuery={initialQuery}
      initialTotal={total}
    />
  );
}
