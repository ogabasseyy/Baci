'use client';

import { Bot, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { useMuseConnections } from './use-muse-connections';

const SCOPE_LABELS: Record<string, string> = {
  'orders:read': 'Orders',
  'inventory:read': 'Inventory',
  'analytics:read': 'Analytics',
};

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never';
  return new Date(expiresAt).toLocaleString();
}

function shortConnectionId(connectionId: string): string {
  return `…${connectionId.slice(-8)}`;
}

export function ConnectionList({
  model,
}: {
  model: ReturnType<typeof useMuseConnections>;
}) {
  const {
    status,
    statusError,
    branches,
    disconnecting,
    confirmingDisconnect,
    setConfirmingDisconnect,
    handleDisconnect,
  } = model;
  const connections = status?.connections ?? [];
  const usableCount = connections.filter(
    (connection) => connection.usable
  ).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3">
            <Bot className="size-6 text-primary" />
          </div>
          <div>
            <CardTitle>Muse</CardTitle>
            <CardDescription>
              Read-only AI access to orders, inventory, and analytics through
              scoped, revocable grants. Connect one agent per row; each
              connection carries its own credential.
            </CardDescription>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            usableCount > 0
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-muted-foreground/20 bg-muted text-muted-foreground'
          }
        >
          {status === null
            ? statusError
              ? 'Unavailable'
              : 'Loading'
            : usableCount > 0
              ? `Connected (${usableCount})`
              : 'Not connected'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-6">
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connections yet. Connect your first agent below.
          </p>
        ) : (
          connections.map((connection) => (
            <div
              key={connection.grantId}
              className="space-y-4 border-t pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Connection {shortConnectionId(connection.connectionId)}
                </p>
                {!connection.usable && (
                  <Badge variant="secondary">
                    {connection.status === 'active' &&
                    connection.expiresAt &&
                    Date.parse(connection.expiresAt) <= Date.now()
                      ? 'expired'
                      : connection.status === 'active'
                        ? 'inactive'
                        : connection.status}
                  </Badge>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-sm font-medium">Scopes</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {connection.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {SCOPE_LABELS[scope] ?? scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">Branch access</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection.merchantWide
                      ? 'Entire merchant'
                      : `${connection.branchIds.length} ${connection.branchIds.length === 1 ? 'branch' : 'branches'}`}
                  </p>
                  {!connection.merchantWide &&
                    connection.branchIds.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {connection.branchIds.map((id) => (
                          <li key={id}>
                            {branches.find((branch) => branch.id === id)
                              ?.name ?? 'Unknown branch'}
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
                <div>
                  <p className="text-sm font-medium">Expires</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatExpiry(connection.expiresAt)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {confirmingDisconnect === connection.grantId ? (
                  <>
                    <Button
                      variant="destructive"
                      disabled={disconnecting !== null}
                      onClick={() => handleDisconnect(connection.grantId)}
                    >
                      <Unplug className="mr-2 size-4" />
                      {disconnecting === connection.grantId
                        ? 'Disconnecting…'
                        : 'Confirm disconnect'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disconnecting !== null}
                      onClick={() => setConfirmingDisconnect(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmingDisconnect(connection.grantId)}
                  >
                    <Unplug className="mr-2 size-4" />
                    Disconnect
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">
                  Disconnecting revokes this connection immediately. Other
                  connections keep working.
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
