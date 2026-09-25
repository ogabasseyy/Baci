'use client';

import {
  AlertTriangle,
  ArrowUpDown,
  ExternalLink,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Unlink,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import jumiaLogo from '@/assets/jumia-logo.png';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { JumiaMarketplaceIdentity } from './jumia-marketplace-identity';
import type { JumiaIntegration } from './use-jumia-integrations';

type JumiaConnectionCardProps = {
  integrations: JumiaIntegration[];
  merchantId?: string;
  canManageIntegrations: boolean;
  onConnect: () => void;
  onAddProducts: (integrationId: string) => void;
  onCheckApprovals: (integrationId: string) => void;
  approvalCheckingIds: ReadonlySet<string>;
  onSyncOrders: (integrationId: string) => void;
  syncingIds: ReadonlySet<string>;
  onSyncStock: (integrationId: string) => void;
  stockSyncingIds: ReadonlySet<string>;
  onDisconnect: (integrationId: string) => void;
};

function formatLastSync(dateString: string | null) {
  if (!dateString) return 'Never';
  return new Date(dateString).toLocaleString('en-NG', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function JumiaConnectionCard({
  integrations,
  merchantId,
  canManageIntegrations,
  onConnect,
  onAddProducts,
  onCheckApprovals,
  approvalCheckingIds,
  onSyncOrders,
  syncingIds,
  onSyncStock,
  stockSyncingIds,
  onDisconnect,
}: JumiaConnectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-lg flex items-center justify-center border overflow-hidden p-1.5">
              <Image
                src={jumiaLogo}
                alt="Jumia"
                width={40}
                height={40}
                className="object-contain"
              />
            </div>
            <div>
              <CardTitle>Jumia</CardTitle>
              <CardDescription>
                Africa&apos;s largest e-commerce platform
              </CardDescription>
            </div>
          </div>

          {integrations.length === 0 ? (
            canManageIntegrations ? (
              <Button onClick={onConnect}>Connect</Button>
            ) : null
          ) : (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="text-green-600 border-green-300 dark:text-green-400 dark:border-green-700"
              >
                Connected
              </Badge>
              {canManageIntegrations && (
                <Button variant="outline" size="sm" onClick={onConnect}>
                  <Plus className="size-4" />
                  Add shop
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      {integrations.length > 0 ? (
        <CardContent className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            Connected Shops
          </p>

          {integrations.map((integration) => (
            <div
              key={integration.id}
              className="flex flex-col gap-4 p-4 rounded-lg border bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {integration.shop_name || 'Unnamed Shop'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {integration.country_code || 'NG'}
                  <JumiaMarketplaceIdentity integration={integration} />{' '}
                  &middot; Last sync: {formatLastSync(integration.last_sync_at)}
                </p>
                {integration.sync_error && (
                  <p className="text-sm text-destructive mt-1 flex items-center gap-1">
                    <AlertTriangle className="size-3.5" />
                    {integration.sync_error}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/dashboard/orders?source=jumia&integrationId=${encodeURIComponent(integration.id)}`}
                  >
                    <Package className="size-4" />
                    <span className="ml-1.5">View orders</span>
                  </Link>
                </Button>
                {canManageIntegrations && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!merchantId}
                      onClick={() => onAddProducts(integration.id)}
                    >
                      <Plus className="size-4" />
                      <span className="ml-1.5">Add Products</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onCheckApprovals(integration.id)}
                      disabled={approvalCheckingIds.has(integration.id)}
                    >
                      {approvalCheckingIds.has(integration.id) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      <span className="ml-1.5">
                        {approvalCheckingIds.has(integration.id)
                          ? 'Checking approvals'
                          : 'Check approvals'}
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSyncOrders(integration.id)}
                      disabled={syncingIds.has(integration.id)}
                    >
                      {syncingIds.has(integration.id) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      <span className="ml-1.5">
                        {syncingIds.has(integration.id)
                          ? 'Syncing Orders'
                          : 'Sync Orders'}
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSyncStock(integration.id)}
                      disabled={stockSyncingIds.has(integration.id)}
                    >
                      {stockSyncingIds.has(integration.id) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowUpDown className="size-4" />
                      )}
                      <span className="ml-1.5">
                        {stockSyncingIds.has(integration.id)
                          ? 'Syncing Stock'
                          : 'Sync Stock'}
                      </span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDisconnect(integration.id)}
                    >
                      <Unlink className="size-4" />
                      <span>Disconnect Jumia</span>
                      <span className="sr-only">
                        {' '}
                        for {integration.shop_name || 'shop'}
                      </span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          <div className="pt-4 border-t flex gap-3">
            {integrations.length === 1 && (
              <Button variant="outline" className="flex-1" asChild>
                <Link
                  href={`/dashboard/orders?source=jumia&integrationId=${encodeURIComponent(integrations[0].id)}`}
                >
                  <Package className="size-4 mr-2" />
                  View Jumia Orders
                </Link>
              </Button>
            )}
            <Button variant="outline" className="flex-1" asChild>
              <a
                href="https://vendorcenter.jumia.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4 mr-2" />
                Vendor Center
              </a>
            </Button>
          </div>
        </CardContent>
      ) : (
        <CardContent>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li className="flex items-center gap-2">
              <Package className="size-4 text-green-500" />
              Receive orders in your Baci dashboard
            </li>
            <li className="flex items-center gap-2">
              <Zap className="size-4 text-green-500" />
              Get push notifications for new orders
            </li>
            <li className="flex items-center gap-2">
              <RefreshCw className="size-4 text-green-500" />
              Manage inventory across platforms
            </li>
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
