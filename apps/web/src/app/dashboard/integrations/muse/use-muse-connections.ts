'use client';
import { useEffect, useRef, useState } from 'react';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import { canManageConnectorConnection } from '@/lib/connector/connection';
import { CONNECTOR_TOOL_SCOPES } from '@/lib/connector/manifest';
import type { ConnectorConnectionView } from '@/schemas/connector';

interface BranchOption {
  id: string;
  name: string;
  is_default: boolean;
}

interface ConnectionStatus {
  connections: ConnectorConnectionView[];
}

interface OneTimeCredentials {
  token: string;
  refreshToken: string;
  /** Grant that produced this pair; disconnects of other grants keep it. */
  grantId: string | null;
}

async function fetchStatus(merchantId: string): Promise<ConnectionStatus> {
  const response = await fetch(
    `/api/integrations/muse?${new URLSearchParams({ merchantId })}`
  );
  if (!response.ok) throw new Error('Connector status unavailable');
  return response.json();
}
async function fetchBranches(merchantId: string): Promise<BranchOption[]> {
  const response = await fetch(
    `/api/branches?${new URLSearchParams({ merchantId })}`
  );
  if (!response.ok) throw new Error('Merchant branches unavailable');
  const data = (await response.json()) as { branches?: BranchOption[] };
  return data.branches ?? [];
}
export function useMuseConnections() {
  const { merchant, staffAccess, loading } = useMerchant();
  const { toast } = useToast();
  const active = useRef(true);
  const pendingConnect = useRef<{ shape: string; connectionId: string } | null>(
    null
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [scopes, setScopes] = useState<string[]>([...CONNECTOR_TOOL_SCOPES]);
  const [merchantWide, setMerchantWide] = useState(true);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('2592000');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<
    string | null
  >(null);
  const [credentials, setCredentials] = useState<OneTimeCredentials | null>(
    null
  );

  const merchantId = merchant?.id ?? null;
  const isOwner = canManageConnectorConnection(staffAccess);

  async function loadStatus() {
    if (!merchantId) return;
    setStatusError(null);
    try {
      const next = await fetchStatus(merchantId);
      if (active.current) setStatus(next);
    } catch {
      if (!active.current) return;
      setStatus(null);
      setStatusError('Could not load the connector status.');
    }
  }

  useEffect(() => {
    if (!merchantId || !isOwner) return;
    let cancelled = false;
    setStatusError(null);
    void fetchStatus(merchantId)
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        if (!cancelled) setStatusError('Could not load the connector status.');
      });
    void fetchBranches(merchantId)
      .then((value) => {
        if (!cancelled) setBranches(value);
      })
      .catch(() => {
        if (!cancelled) setStatusError('Could not load the merchant branches.');
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId, isOwner]);

  function toggleScope(scope: string, checked: boolean) {
    setScopes((current) =>
      checked
        ? [...new Set([...current, scope])]
        : current.filter((item) => item !== scope)
    );
  }

  function toggleBranch(branchId: string, checked: boolean) {
    setBranchIds((current) =>
      checked
        ? [...new Set([...current, branchId])]
        : current.filter((item) => item !== branchId)
    );
  }

  async function handleConnect() {
    if (!merchantId || connecting) return;
    setConnecting(true);
    const requestBody = {
      merchantId,
      branchIds: merchantWide ? [] : branchIds,
      expiresInSeconds: expiry === 'never' ? null : Number(expiry),
      merchantWide,
      scopes,
    };
    const shape = JSON.stringify(requestBody);
    if (pendingConnect.current?.shape !== shape)
      pendingConnect.current = { shape, connectionId: crypto.randomUUID() };
    try {
      const response = await fetchWithCsrf('/api/integrations/muse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          connectionId: pendingConnect.current.connectionId,
        }),
      });
      const data = (await response.json()) as Partial<OneTimeCredentials> & {
        alreadyConnected?: boolean;
        error?: string;
        grant?: { grantId?: string };
      };
      if (!active.current) return;
      if (!response.ok) {
        toast({
          title: 'Connection failed',
          description: data.error ?? 'Could not connect Muse.',
          variant: 'destructive',
        });
        return;
      }
      pendingConnect.current = null;
      // Credentials first: a status-refresh failure must never discard
      // the one-time pair or misreport this success as a failure.
      if (data.token && data.refreshToken) {
        setCredentials({
          token: data.token,
          refreshToken: data.refreshToken,
          grantId: data.grant?.grantId ?? null,
        });
      }
      await loadStatus();
      if (!active.current) return;
      toast({
        title: 'Muse connected',
        description: data.alreadyConnected
          ? 'Reissued fresh credentials for this connection.'
          : 'Grant created for this merchant.',
      });
    } catch {
      if (!active.current) return;
      toast({
        title: 'Connection failed',
        description: 'Could not connect Muse.',
        variant: 'destructive',
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(grantId: string) {
    if (!merchantId || disconnecting) return;
    setDisconnecting(grantId);
    try {
      const response = await fetchWithCsrf('/api/integrations/muse', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId,
          grantId,
        }),
      });
      const data = (await response.json()) as {
        revoked?: boolean;
        error?: string;
      };
      if (!active.current) return;
      if (!response.ok) {
        toast({
          title: 'Disconnect failed',
          description: data.error ?? 'Could not disconnect Muse.',
          variant: 'destructive',
        });
        return;
      }
      await loadStatus();
      if (!active.current) return;
      // Only the revoked grant's own pair dies on screen: other
      // connections' credentials stay visible.
      if (credentials?.grantId === grantId) {
        setCredentials(null);
      }
      setConfirmingDisconnect(null);
      toast({
        title:
          data.revoked === false ? 'Already inactive' : 'Muse disconnected',
        description:
          data.revoked === false
            ? 'That connection was already expired or revoked.'
            : 'Connector access was revoked immediately.',
      });
    } catch {
      if (!active.current) return;
      toast({
        title: 'Disconnect failed',
        description: 'Could not disconnect Muse.',
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(null);
    }
  }

  return {
    merchant,
    loading,
    isOwner,
    status,
    statusError,
    branches,
    scopes,
    merchantWide,
    branchIds,
    expiry,
    connecting,
    disconnecting,
    confirmingDisconnect,
    credentials,
    setMerchantWide,
    setExpiry,
    setConfirmingDisconnect,
    toggleScope,
    toggleBranch,
    handleConnect,
    handleDisconnect,
  };
}
