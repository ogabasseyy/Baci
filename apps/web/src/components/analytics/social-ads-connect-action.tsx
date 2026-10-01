'use client';

import { ExternalLink } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface SocialAdsConnectActionProps {
  displayName: string;
  href: string;
  navigateTo?: (href: string) => void;
  reconnect: boolean;
}

async function readConnectError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

async function readAuthorizationUrl(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { authorizationUrl?: unknown };
    if (typeof payload.authorizationUrl === 'string') {
      return payload.authorizationUrl;
    }
  } catch {
    // Fall through to the actionable integration error below.
  }
  throw new Error(fallback);
}

export function SocialAdsConnectAction({
  displayName,
  href,
  navigateTo,
  reconnect,
}: SocialAdsConnectActionProps) {
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (isConnecting) return;

    setConnectError(null);
    setIsConnecting(true);
    try {
      const response = await fetch(href, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          await readConnectError(response, `Unable to connect ${displayName}.`)
        );
      }

      (navigateTo ?? ((target: string) => window.location.assign(target)))(
        await readAuthorizationUrl(
          response,
          `Unable to connect ${displayName}.`
        )
      );
    } catch (error: unknown) {
      setConnectError(
        error instanceof Error
          ? error.message
          : `Unable to connect ${displayName}.`
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <>
      {connectError && (
        <Alert variant="destructive">
          <AlertDescription>{connectError}</AlertDescription>
        </Alert>
      )}
      <Button asChild size="sm">
        <a aria-disabled={isConnecting} href={href} onClick={handleConnect}>
          {isConnecting
            ? `Connecting ${displayName}…`
            : `${reconnect ? 'Reconnect' : 'Connect'} ${displayName}`}
          <ExternalLink className="size-4" />
        </a>
      </Button>
    </>
  );
}
