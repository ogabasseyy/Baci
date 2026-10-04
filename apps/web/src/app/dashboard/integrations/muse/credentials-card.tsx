'use client';

import { KeyRound } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';

import type { useMuseConnections } from './use-muse-connections';

export function CredentialsCard({
  model,
}: {
  model: ReturnType<typeof useMuseConnections>;
}) {
  const { credentials } = model;
  return (
    <>
      {credentials && (
        <Card className="border-amber-500/40">
          <CardHeader className="flex flex-row items-center gap-3">
            <KeyRound className="size-5 text-amber-500" />
            <div>
              <CardTitle>Copy your connector credentials</CardTitle>
              <CardDescription>
                Shown once. Paste the access token into your Muse custom
                connector&apos;s HTTP Bearer authentication field, then store
                both somewhere safe.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
                {credentials.token}
              </code>
              <CopyButton value={credentials.token} label="Copy token" />
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
                {credentials.refreshToken}
              </code>
              <CopyButton
                value={credentials.refreshToken}
                label="Copy refresh token"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
