'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { JumiaDiscoveredShop } from './use-jumia-integrations';

export function getJumiaShopSelectionId(shop: JumiaDiscoveredShop): string {
  return shop.selectionKey ?? shop.id;
}

type ConnectJumiaManualFormProps = {
  clientId: string;
  refreshToken: string;
  discovering: boolean;
  canResumeDiscovery: boolean;
  connecting: boolean;
  discoveredShops: JumiaDiscoveredShop[];
  selectedShopIds: Set<string>;
  onClientIdChange: (value: string) => void;
  onRefreshTokenChange: (value: string) => void;
  onDiscover: () => void;
  onConnectSelected: () => void;
  onToggleShop: (shopId: string, disabled: boolean) => void;
};

export function ConnectJumiaManualForm({
  clientId,
  refreshToken,
  discovering,
  canResumeDiscovery,
  connecting,
  discoveredShops,
  selectedShopIds,
  onClientIdChange,
  onRefreshTokenChange,
  onDiscover,
  onConnectSelected,
  onToggleShop,
}: ConnectJumiaManualFormProps) {
  const selectableShops = discoveredShops.filter(
    (shop) => !shop.alreadyConnected
  );

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <p className="text-xs text-muted-foreground p-3 bg-muted rounded-md">
        Go to <strong>Settings &rarr; Applications</strong> in Jumia Vendor
        Center, create a &ldquo;Self Authorization&rdquo; app, and copy the
        client ID and refresh token.
      </p>

      <div className="space-y-2">
        <Label htmlFor="clientId">Client ID</Label>
        <Input
          id="clientId"
          value={clientId}
          onChange={(event) => onClientIdChange(event.target.value)}
          placeholder="Your Jumia application client ID"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refreshToken">Refresh Token</Label>
        <Input
          id="refreshToken"
          type="password"
          autoComplete="new-password"
          value={refreshToken}
          onChange={(event) => onRefreshTokenChange(event.target.value)}
          placeholder="Paste your token..."
          className="font-mono text-sm"
        />
      </div>

      <Button
        className="w-full"
        onClick={onDiscover}
        disabled={
          discovering ||
          !clientId.trim() ||
          (!refreshToken.trim() && !canResumeDiscovery)
        }
      >
        {discovering && <Loader2 className="size-4 mr-2 animate-spin" />}
        {discovering ? 'Discovering shops...' : 'Discover shops'}
      </Button>

      {discoveredShops.length > 0 && (
        <div className="space-y-3">
          <Label>Select shops to connect</Label>
          <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
            {discoveredShops.map((shop) => {
              const shopId = getJumiaShopSelectionId(shop);
              const disabled = shop.alreadyConnected;
              return (
                <label
                  key={shopId}
                  htmlFor={`shop-${shopId}`}
                  className="flex items-start gap-3 text-sm"
                >
                  <Checkbox
                    id={`shop-${shopId}`}
                    checked={disabled ? true : selectedShopIds.has(shopId)}
                    disabled={disabled}
                    onCheckedChange={() => onToggleShop(shopId, disabled)}
                  />
                  <span>
                    <span className="font-medium">{shop.name}</span>
                    <span className="block text-muted-foreground">
                      {shop.marketplace} ({shop.countryCode})
                      {disabled ? ' — already connected' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <Button
            className="w-full"
            onClick={onConnectSelected}
            disabled={
              connecting ||
              selectableShops.length === 0 ||
              selectedShopIds.size === 0
            }
          >
            {connecting && <Loader2 className="size-4 mr-2 animate-spin" />}
            {connecting
              ? 'Connecting...'
              : `Connect ${selectedShopIds.size} shop${selectedShopIds.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}
    </div>
  );
}
