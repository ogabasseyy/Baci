'use client';

import { KeyRound, Zap } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ConnectJumiaManualForm } from './connect-jumia-manual-form';
import { jumiaDiscoveryResumeStorage } from './jumia-discovery-resume-storage';
import {
  connectJumiaShops,
  discoverJumiaShops,
  type JumiaDiscoveredShop,
} from './use-jumia-integrations';

interface ConnectJumiaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

export function ConnectJumiaDialog({
  open,
  onOpenChange,
  onConnected,
}: ConnectJumiaDialogProps) {
  const { toast } = useToast();
  const [resume] = useState(jumiaDiscoveryResumeStorage.read);
  const [showManualForm, setShowManualForm] = useState(Boolean(resume));
  const [discovering, setDiscovering] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [clientId, setClientId] = useState(resume?.clientId ?? '');
  const [refreshToken, setRefreshToken] = useState('');
  const [activeDiscoveryId, setActiveDiscoveryId] = useState(
    resume?.discoveryId ?? ''
  );
  const [discoveredShops, setDiscoveredShops] = useState<JumiaDiscoveredShop[]>(
    []
  );
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string>>(
    new Set()
  );

  const resetManualForm = () => {
    setClientId('');
    setRefreshToken('');
    setActiveDiscoveryId('');
    setDiscoveredShops([]);
    setSelectedShopIds(new Set());
    jumiaDiscoveryResumeStorage.clear();
  };

  const clearDiscoveryState = () => {
    setActiveDiscoveryId('');
    setDiscoveredShops([]);
    setSelectedShopIds(new Set());
    jumiaDiscoveryResumeStorage.clear();
  };

  const handleDiscover = async () => {
    if (!clientId.trim() || !(refreshToken.trim() || activeDiscoveryId)) return;

    setDiscovering(true);
    const result = await discoverJumiaShops(
      clientId,
      refreshToken,
      activeDiscoveryId || undefined
    );
    setDiscovering(false);

    if (!result.ok) {
      if (result.discoveryId && result.retryable) {
        setActiveDiscoveryId(result.discoveryId);
        // The server rotated the submitted refresh token before failing, so
        // the recovery handle is the only way to resume; persist it before
        // a reload can strand the merchant on the dead credential.
        jumiaDiscoveryResumeStorage.write(clientId, result.discoveryId);
        setDiscoveredShops([]);
        setSelectedShopIds(new Set());
        setRefreshToken('');
      } else {
        clearDiscoveryState();
      }
      toast({
        title: 'Discovery failed',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }

    const shops = result.shops ?? [];
    if (!result.discoveryId) {
      clearDiscoveryState();
      toast({
        title: 'Discovery failed',
        description: 'Shop discovery failed',
        variant: 'destructive',
      });
      return;
    }

    setDiscoveredShops(shops);
    setActiveDiscoveryId(result.discoveryId);
    jumiaDiscoveryResumeStorage.write(clientId, result.discoveryId);
    // Require an explicit merchant choice for every destination returned by
    // discovery. Already-connected shops remain visibly checked and disabled
    // in the form, but new shops must never be connected implicitly.
    setSelectedShopIds(new Set());

    if (shops.length === 0) {
      toast({
        title: 'No shops found',
        description: 'Jumia did not return any shops for this authorization.',
        variant: 'destructive',
      });
    }
  };

  const handleConnectSelected = async () => {
    if (selectedShopIds.size === 0 || !activeDiscoveryId) return;

    setConnecting(true);
    const result = await connectJumiaShops(
      clientId,
      activeDiscoveryId,
      Array.from(selectedShopIds)
    );
    setConnecting(false);

    if (result.ok) {
      toast({ title: 'Jumia account connected successfully!' });
      onOpenChange(false);
      if (result.discoveryComplete !== false) {
        resetManualForm();
      } else {
        // The server keeps a resumable discovery when only part of the
        // returned destinations was connected. Retain its opaque handle and
        // client ID so the merchant can finish the selection later.
        setRefreshToken('');
        setSelectedShopIds(new Set());
        jumiaDiscoveryResumeStorage.write(
          clientId,
          result.discoveryId ?? activeDiscoveryId
        );
      }
      if (result.discoveryId) {
        setActiveDiscoveryId(result.discoveryId);
        if (result.discoveryComplete !== true) {
          jumiaDiscoveryResumeStorage.write(clientId, result.discoveryId);
        }
      }
      setShowManualForm(false);
      onConnected();
      return;
    }

    if (result.discoveryId && result.retryable) {
      setActiveDiscoveryId(result.discoveryId);
      jumiaDiscoveryResumeStorage.write(clientId, result.discoveryId);
      setRefreshToken('');
      setDiscoveredShops([]);
      setSelectedShopIds(new Set());
    }
    toast({
      title: 'Connection failed',
      description: result.error,
      variant: 'destructive',
    });
  };

  const toggleShop = (shopId: string, disabled: boolean) => {
    if (disabled) return;
    setSelectedShopIds((current) => {
      const next = new Set(current);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Jumia may rotate the submitted refresh credential during discovery.
      // Keep only the opaque resumable discovery state if the merchant closes
      // the dialog, while clearing the sensitive credential from the form.
      setRefreshToken('');
      setShowManualForm(false);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Jumia Account</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-900/10 dark:border-emerald-900/30">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <KeyRound className="size-5 text-emerald-600" />
                Self Authorization
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  Recommended
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Recommended for continuous and background sync. Use a Jumia Self
                Authorization app so Baci can renew access automatically.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowManualForm(!showManualForm)}
              >
                <KeyRound className="size-4 mr-2" />
                {showManualForm
                  ? 'Hide Self Authorization'
                  : 'Enter Refresh Token'}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-orange-200 bg-orange-50/50 dark:bg-orange-900/10 dark:border-orange-900/30">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <Zap className="size-5 text-orange-500" />
                Web Application OAuth
              </div>
              <p className="text-sm text-muted-foreground">
                Temporary connection for a quick start. You will need to
                re-login after the Jumia access token expires.
              </p>
              <Button
                className="w-full bg-[#f68b1e] hover:bg-[#e07e1b]"
                asChild
              >
                <a href="/api/marketplace/jumia/connect?connectionType=oauth">
                  Connect with Jumia
                </a>
              </Button>
            </CardContent>
          </Card>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or connect manually
              </span>
            </div>
          </div>

          {showManualForm && (
            <ConnectJumiaManualForm
              clientId={clientId}
              refreshToken={refreshToken}
              discovering={discovering}
              canResumeDiscovery={Boolean(activeDiscoveryId)}
              connecting={connecting}
              discoveredShops={discoveredShops}
              selectedShopIds={selectedShopIds}
              onClientIdChange={(value) => {
                setClientId(value);
                clearDiscoveryState();
              }}
              onRefreshTokenChange={(value) => {
                setRefreshToken(value);
                clearDiscoveryState();
              }}
              onDiscover={handleDiscover}
              onConnectSelected={handleConnectSelected}
              onToggleShop={toggleShop}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
