'use client';

import { ArrowLeft, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { asRoute } from '@/lib/routes';
import { ConnectForm } from './connect-form';
import { ConnectionList } from './connection-list';
import { CredentialsCard } from './credentials-card';
import { useMuseConnections } from './use-muse-connections';

export default function MuseIntegrationPage() {
  const model = useMuseConnections();
  const { merchant, loading, isOwner, statusError } = model;
  if (loading || !merchant) {
    return (
      <div
        className="space-y-6"
        role="status"
        aria-label="Loading Muse integration"
      >
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Owner-only UI gating (the API routes enforce the same rule
  // server-side; staff never reach the connect form or grant metadata).
  if (!isOwner) {
    return (
      <div className="space-y-6">
        <BackHeader />
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <ShieldAlert className="size-5 text-amber-500" />
            <div>
              <CardTitle>Owners only</CardTitle>
              <CardDescription>
                Only the merchant owner can manage the Muse connector. Ask the
                owner to connect or disconnect it.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackHeader />

      {statusError && (
        <Alert variant="destructive">
          <AlertTitle>Status unavailable</AlertTitle>
          <AlertDescription>{statusError}</AlertDescription>
        </Alert>
      )}

      <ConnectionList model={model} />
      <CredentialsCard model={model} />
      <ConnectForm model={model} />
    </div>
  );
}

function BackHeader() {
  return (
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="icon" asChild>
        <Link
          href={asRoute('/dashboard/integrations')}
          aria-label="Back to integrations"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Muse</h1>
        <p className="text-muted-foreground">
          Scoped, revocable AI access for this merchant
        </p>
      </div>
    </div>
  );
}
