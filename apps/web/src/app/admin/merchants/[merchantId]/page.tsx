import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getAdminMerchant360 } from '@/lib/admin-merchant-360';
import { createClient } from '@/lib/supabase/server';
import { adminMerchantRouteParamsSchema } from '@/schemas/admin-merchant-route-params';
import { Merchant360Content } from './merchant-360-content';

type Merchant360PageProps = {
  params: Promise<{ merchantId: string }>;
};
export default async function Merchant360Page({
  params,
}: Merchant360PageProps) {
  const parseResult = adminMerchantRouteParamsSchema.safeParse(await params);
  if (!parseResult.success) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await getAdminMerchant360(
    supabase,
    parseResult.data.merchantId
  );
  if (error?.code === '42501') {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            Platform-admin access is required to view merchant operations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/admin">Back to overview</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    console.error('[Admin] Failed to load merchant operations snapshot:', {
      code: error.code,
      merchantId: parseResult.data.merchantId,
    });
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>Merchant operations could not load</CardTitle>
          <CardDescription>
            The operations snapshot is temporarily unavailable. No merchant data
            was changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/admin/merchants">Back to merchants</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    notFound();
  }

  return <Merchant360Content data={data} />;
}
