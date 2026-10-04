import { selectReceiptDisplayDate } from '@baci/shared/receipt';
import { Download, FileText } from 'lucide-react';
import Link from 'next/link';
import {
  formatArchiveDate,
  resolveArchiveDocumentKind,
} from '@/app/(storefront)/[slug]/(customer)/receipts/archive-display';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { asRoute } from '@/lib/routes';
import type { StorefrontOrder } from '@/types/storefront-order';

interface ArchiveOrderCardProps {
  order: StorefrontOrder;
  merchantSlug: string;
  getHref: (path: string) => string;
}

export function ArchiveOrderCard({
  order,
  merchantSlug,
  getHref,
}: ArchiveOrderCardProps) {
  const documentKind = order.current_document_kind || 'invoice';
  const archiveKind = resolveArchiveDocumentKind(order);
  const downloadHref = `/api/storefront/account/orders/${order.id}/${documentKind}?merchantSlug=${encodeURIComponent(merchantSlug)}`;
  const downloadLabel =
    archiveKind === 'receipt'
      ? 'Receipt'
      : archiveKind === 'proforma'
        ? 'Proforma Invoice'
        : 'Invoice';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 gap-y-0">
        <div>
          <CardTitle className="text-lg">#{order.order_number}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatArchiveDate(selectReceiptDisplayDate(order))} •{' '}
            {order.items[0]?.product_name || order.items[0]?.name || 'Order'}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium capitalize">
          <FileText className="size-3.5" />
          {archiveKind}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          <p>
            Total: {formatDisplayCurrency(order.total, order.currency || 'NGN')}
          </p>
          <p className="capitalize">Status: {order.shipping_status}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link href={asRoute(getHref(`/account/orders/${order.id}`))}>
              View Order
            </Link>
          </Button>
          <Button asChild>
            <a href={downloadHref}>
              <Download className="mr-2 size-4" />
              Download {downloadLabel}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
