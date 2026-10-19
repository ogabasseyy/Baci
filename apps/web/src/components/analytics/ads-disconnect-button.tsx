'use client';

import { Loader2, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { fetchWithCsrf } from '@/lib/api-client';

type AdsProvider = 'google' | 'meta' | 'snapchat' | 'tiktok';

interface AdsDisconnectButtonProps {
  displayName: string;
  merchantId?: string;
  onDisconnected?: () => void;
  provider: AdsProvider;
}

async function readDisconnectError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export function AdsDisconnectButton({
  displayName,
  merchantId,
  onDisconnected,
  provider,
}: AdsDisconnectButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const disconnect = async () => {
    setError(null);
    setIsDisconnecting(true);
    try {
      const response = await fetchWithCsrf(
        `/api/integrations/ads/${provider}/disconnect`,
        {
          headers: merchantId
            ? { 'x-baci-merchant-id': merchantId }
            : undefined,
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        throw new Error(
          await readDisconnectError(
            response,
            `Unable to disconnect ${displayName}.`
          )
        );
      }
      onDisconnected?.();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : `Unable to disconnect ${displayName}.`
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-2">
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            disabled={isDisconnecting}
            size="sm"
            type="button"
            variant="outline"
          >
            {isDisconnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Unplug className="size-4" />
            )}
            {isDisconnecting
              ? `Disconnecting ${displayName}…`
              : `Disconnect ${displayName}`}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved Ads credentials and reporting connection.
              You will need to reconnect the account before metrics can sync
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isDisconnecting} onClick={disconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
