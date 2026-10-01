'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { AdminPlatformAccessMembership } from '@/schemas/admin-platform-access';
import { AccessMembersTable } from './access-members-table';
import {
  ACCESS_ROSTER_PAGE_SIZE,
  loadAccessMembers,
} from './access-roster-loader';
import { GrantAccessForm } from './grant-access-form';
import { RevokeAccessForm } from './revoke-access-form';

export function AccessManagementClient() {
  const { toast } = useToast();
  const [members, setMembers] = useState<AdminPlatformAccessMembership[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [rosterTruncated, setRosterTruncated] = useState(false);
  const [rosterOffset, setRosterOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] =
    useState<AdminPlatformAccessMembership | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadAccessMembers(0, ACCESS_ROSTER_PAGE_SIZE);
      setMembers(result.data);
      setGeneratedAt(result.generatedAt);
      setRosterTruncated(result.truncated);
      setRosterOffset(result.data.length);
    } catch {
      setMembers([]);
      setRosterTruncated(false);
      setRosterOffset(0);
      setLoadError(
        'Platform access could not be loaded. Refresh to try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const loadMoreMembers = async () => {
    if (!rosterTruncated || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await loadAccessMembers(
        rosterOffset,
        ACCESS_ROSTER_PAGE_SIZE
      );
      setMembers((current) => [...current, ...result.data]);
      setGeneratedAt(result.generatedAt);
      setRosterTruncated(result.truncated);
      setRosterOffset((current) => current + result.data.length);
    } catch {
      toast({
        title: 'Additional members could not be loaded',
        description: 'Refresh the roster and try again.',
        variant: 'destructive',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial read only; refresh is user-triggered after mount.
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-l-4 border-primary pl-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Platform security
          </p>
          <h1 className="mt-1 text-page-title">Access management</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Assign only the platform role required for the work. Every change
            requires a reason, confirmation, and an immutable audit record.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      <GrantAccessForm onUpdated={refresh} />

      {revokeTarget ? (
        <RevokeAccessForm
          member={revokeTarget}
          onCancel={() => setRevokeTarget(null)}
          onComplete={async () => {
            setRevokeTarget(null);
            await refresh();
          }}
        />
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Current access</CardTitle>
          {generatedAt ? <Badge variant="outline">Live</Badge> : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}
          {loadError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}
          {!loading && !loadError ? (
            <>
              <AccessMembersTable
                members={members}
                onRevoke={setRevokeTarget}
              />
              {rosterTruncated && (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-700" role="status">
                    Showing {members.length} platform members. Load more to
                    manage additional accounts.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={() => void loadMoreMembers()}
                  >
                    {loadingMore ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Load more
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
