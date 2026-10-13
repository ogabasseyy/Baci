// Required for dropdown interactions and window.open storefront navigation.
'use client';

import { ExternalLink, Mail, MoreHorizontal, Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DEFAULT_ADMIN_STORE_NAME } from '@/config/admin-merchants';
import { formatAdminThresholdCurrency } from '@/lib/admin-currency';
import { formatAdminMerchantDate } from '@/lib/admin-merchant-utils';
import { generateSlug } from '@/lib/seo-utils';
import type { AdminMerchantHealthRow } from '@/types/admin-merchants';
import { MerchantHealthBadge } from './merchant-health-badge';

function getStorefrontHref(merchant: AdminMerchantHealthRow): string | null {
  const storefrontSlug = (merchant.storefront_slug ?? '').trim();
  if (storefrontSlug) {
    return `/${storefrontSlug}`;
  }

  const generatedSlug = generateSlug(merchant.business_name || '');
  if (generatedSlug) {
    return `/${generatedSlug}`;
  }

  return null;
}

export function MerchantTable({
  merchants,
  onInvalidStorefrontUrl,
}: {
  merchants: AdminMerchantHealthRow[];
  onInvalidStorefrontUrl: () => void;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Business</TableHead>
            <TableHead>Paid Sales Activity</TableHead>
            <TableHead className="text-right">
              NGN Paid GMV Since Launch
            </TableHead>
            <TableHead className="text-right">Paid Orders</TableHead>
            <TableHead>Latest Paid Order Created</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {merchants.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-8 text-center text-muted-foreground"
              >
                No merchants found
              </TableCell>
            </TableRow>
          ) : (
            merchants.map((merchant) => (
              <TableRow key={merchant.merchant_id}>
                <TableCell>
                  <div>
                    <Link
                      href={`/admin/merchants/${merchant.merchant_id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {merchant.business_name || DEFAULT_ADMIN_STORE_NAME}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {merchant.email || 'No email'}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <MerchantHealthBadge status={merchant.health_status} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatAdminThresholdCurrency(merchant.total_gmv)}
                  {merchant.excluded_non_ngn_or_unknown_paid_orders > 0 ? (
                    <p className="text-xs font-normal text-muted-foreground">
                      {merchant.excluded_non_ngn_or_unknown_paid_orders}{' '}
                      non-NGN/unknown paid order(s) excluded
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {merchant.total_orders || 0}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatAdminMerchantDate(merchant.last_order_date)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatAdminMerchantDate(merchant.joined_at)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/merchants/${merchant.merchant_id}`}>
                          <Users className="mr-2 size-4" aria-hidden="true" />
                          View Merchant 360
                        </Link>
                      </DropdownMenuItem>
                      {merchant.email ? (
                        <DropdownMenuItem asChild>
                          <a href={`mailto:${merchant.email}`}>
                            <Mail className="mr-2 size-4" aria-hidden="true" />
                            Send Email
                          </a>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled>
                          <Mail className="mr-2 size-4" aria-hidden="true" />
                          Send Email
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => {
                          const storefrontHref = getStorefrontHref(merchant);
                          if (storefrontHref) {
                            window.open(
                              storefrontHref,
                              '_blank',
                              'noopener,noreferrer'
                            );
                          } else {
                            onInvalidStorefrontUrl();
                          }
                        }}
                      >
                        <ExternalLink
                          className="mr-2 size-4"
                          aria-hidden="true"
                        />
                        View Store
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
