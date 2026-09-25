'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PublishProductsDialog } from '@/components/products/jumia/publish-products-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BagLoader } from '@/components/ui/bag-loader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { ConnectJumiaDialog } from './connect-jumia-dialog';
import { JumiaConnectionCard } from './jumia-connection-card';
import { useJumiaChannelActions } from './use-jumia-channel-actions';
import {
  disconnectIntegration,
  syncOrders,
  useJumiaIntegrations,
} from './use-jumia-integrations';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  no_code: 'Authorization failed — no code received',
  invalid_state: 'Security validation failed — please try again',
  session_expired: 'Session expired — please try again',
  database_error: 'Failed to save connection — please try again',
  connection_failed: 'Connection failed — please try again',
  token_exchange_failed:
    'Jumia rejected the token exchange — check redirect URI and credentials',
  merchant_not_found: 'Merchant account not found — please log in again',
  oauth_not_configured:
    'Jumia OAuth is not configured — please contact support or try again later',
  no_shops_discovered:
    'Connected but no active shops discovered — please check your Jumia Vendor Center',
};

export default function ChannelsClientPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const canManageIntegrations =
    merchantContext?.hasPermission?.('integrations', 'manage') ?? false;
  const {
    integrations,
    setIntegrations,
    loading,
    error: fetchError,
    refetch,
  } = useJumiaIntegrations();

  const [showConnectModal, setShowConnectModal] = useState(false);
  const {
    syncingIds,
    stockSyncingIds,
    approvalCheckingIds,
    publishIntegrationId,
    setPublishIntegrationId,
    handleSync,
    handleStockSync,
    handleCheckApprovals,
  } = useJumiaChannelActions({ refetch, toast });
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const handledOauthParamsRef = useRef<string | null>(null);

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const handledKey = success
      ? `success:${success}:${searchParams.get('shops') ?? ''}`
      : error
        ? `error:${error}`
        : null;

    if (!handledKey || handledOauthParamsRef.current === handledKey) {
      return;
    }
    handledOauthParamsRef.current = handledKey;

    if (success === 'jumia_connected') {
      const newShopIds =
        searchParams.get('shops')?.split(',').filter(Boolean) ?? [];
      toast({ title: 'Jumia account connected successfully!' });

      void refetch().then(async (freshIntegrations) => {
        router.replace('/dashboard/channels');

        if (newShopIds.length === 0) return;

        const newOnes = freshIntegrations.filter((i) =>
          newShopIds.includes(i.shop_id)
        );
        if (newOnes.length === 0) return;

        toast({ title: 'Syncing your Jumia orders...' });
        const results = await Promise.all(newOnes.map((i) => syncOrders(i.id)));
        const ok = results.filter((r) => r.ok);
        if (ok.length > 0) {
          toast({ title: ok[0].message || 'Orders synced!' });
          await refetch();
        } else {
          const fail = results.find((r) => !r.ok);
          toast({
            title: 'Order sync failed',
            description: fail?.error || 'Please try again',
            variant: 'destructive',
          });
        }
      });
    } else if (error) {
      toast({
        title: 'Connection Error',
        description: OAUTH_ERROR_MESSAGES[error] || `Error: ${error}`,
        variant: 'destructive',
      });
      router.replace('/dashboard/channels');
    }
  }, [searchParams, refetch, router, toast]);

  const handleDisconnect = async () => {
    if (!disconnectId) return;
    const result = await disconnectIntegration(disconnectId);

    if (result.ok) {
      toast({ title: 'Jumia account disconnected' });
      setIntegrations((prev) => prev.filter((i) => i.id !== disconnectId));
    } else {
      toast({
        title: 'Disconnect failed',
        description: result.error,
        variant: 'destructive',
      });
    }
    setDisconnectId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <BagLoader size={48} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-linear-to-r from-primary via-purple-500 to-blue-600 bg-clip-text text-transparent">
          Marketplaces
        </h1>
        <p className="text-muted-foreground mt-2">
          Connect marketplaces to sell on multiple platforms from Baci
        </p>
      </div>

      {fetchError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="size-4" />
              {fetchError}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={refetch}
            >
              <RefreshCw className="size-4 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <JumiaConnectionCard
        integrations={integrations}
        merchantId={merchant?.id}
        canManageIntegrations={canManageIntegrations}
        onConnect={() => setShowConnectModal(true)}
        onAddProducts={setPublishIntegrationId}
        onCheckApprovals={handleCheckApprovals}
        approvalCheckingIds={approvalCheckingIds}
        onSyncOrders={handleSync}
        syncingIds={syncingIds}
        onSyncStock={handleStockSync}
        stockSyncingIds={stockSyncingIds}
        onDisconnect={setDisconnectId}
      />

      {/* Konga — Coming Soon */}
      <Card className="border-dashed opacity-60">
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="size-12 bg-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-2xl font-bold text-white">K</span>
            </div>
            <div>
              <CardTitle>Konga</CardTitle>
              <CardDescription>Coming Soon</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Connect Modal */}
      <ConnectJumiaDialog
        open={showConnectModal}
        onOpenChange={setShowConnectModal}
        onConnected={refetch}
      />

      {merchant?.id && publishIntegrationId && (
        <PublishProductsDialog
          merchantId={merchant.id}
          integrationId={publishIntegrationId}
          countryCode={
            integrations.find(
              (integration) => integration.id === publishIntegrationId
            )?.country_code ?? 'NG'
          }
          open
          onOpenChange={(open) => !open && setPublishIntegrationId(null)}
        />
      )}

      {/* Disconnect Confirmation */}
      <AlertDialog
        open={disconnectId !== null}
        onOpenChange={(open) => !open && setDisconnectId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Jumia Account?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll need to reconnect to continue syncing orders from this
              shop.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
