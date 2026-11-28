'use client';

import {
  AlertCircle,
  Check,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import type { DomainVerificationRecord } from '@/schemas/cloudflare-saas';
import { setPrimaryDomain } from '../actions';

export interface Domain {
  id: string;
  domain: string;
  tld: string;
  domain_type: 'subdomain' | 'custom' | 'purchased';
  status: 'pending' | 'verifying' | 'active' | 'failed' | 'expired';
  is_primary: boolean;
  verification_token?: string;
  verified_at: string | null;
  ssl_status: 'pending' | 'active' | 'failed';
  purchase_info?: {
    expires_at?: string;
    auto_renew?: boolean;
    cost_price?: number;
    sell_price?: number;
  };
  created_at: string;
}

interface DomainCardProps {
  domain: Domain;
}

const DOMAIN_REQUEST_TIMEOUT_MS = 10_000;

type ToastFn = ReturnType<typeof useToast>['toast'];
type AppRouter = ReturnType<typeof useRouter>;

interface DomainActionContext {
  domainName: string;
  toast: ToastFn;
  router: AppRouter;
}

// Module-scope helpers keep try/finally out of the component body
// (React Compiler cannot lower try/finally inside components yet).
async function runVerifyDomain({
  domainName,
  toast,
  router,
  setIsVerifying,
  setPendingRecords,
}: DomainActionContext & {
  setIsVerifying: (verifying: boolean) => void;
  setPendingRecords: (records: DomainVerificationRecord[]) => void;
}): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DOMAIN_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetchWithCsrf(
      `/api/domains/${encodeURIComponent(domainName)}/verify`,
      {
        method: 'POST',
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await response.json();

    if (response.ok && data.success) {
      setPendingRecords([]);
      toast({
        title: 'Domain Verified! ✅',
        description: `${domainName} has been verified and is now active.`,
      });
      router.refresh();
    } else {
      if (Array.isArray(data.verificationRecords)) {
        setPendingRecords(data.verificationRecords);
      }
      toast({
        title: 'Verification Failed',
        description:
          data.error ||
          'Could not verify domain. Please check your DNS records.',
        variant: 'destructive',
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error verifying domain', error);
    toast({
      title: 'Verification Error',
      description:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out. Please try again.'
          : 'An error occurred while verifying the domain. Please try again.',
      variant: 'destructive',
    });
  } finally {
    setIsVerifying(false);
  }
}

async function runDeleteDomain({
  domainName,
  toast,
  router,
  setIsDeleting,
  setShowDeleteDialog,
}: DomainActionContext & {
  setIsDeleting: (deleting: boolean) => void;
  setShowDeleteDialog: (open: boolean) => void;
}): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DOMAIN_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetchWithCsrf(
      `/api/domains/${encodeURIComponent(domainName)}`,
      {
        method: 'DELETE',
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (response.ok) {
      toast({
        title: 'Domain Deleted',
        description: 'The domain has been successfully removed.',
      });
      setShowDeleteDialog(false);
      router.refresh();
    } else {
      const data = await response.json();
      toast({
        title: 'Error',
        description: data.error || 'Failed to delete domain',
        variant: 'destructive',
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error deleting domain', error);
    toast({
      title: 'Error',
      description:
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out. Please try again.'
          : 'An error occurred while deleting the domain',
      variant: 'destructive',
    });
  } finally {
    // Keep the dialog open on failure so the user can retry without
    // reopening it; it is closed explicitly on success above.
    setIsDeleting(false);
  }
}

async function runSetPrimaryDomain({
  domainName,
  toast,
  router,
  setIsSettingPrimary,
}: DomainActionContext & {
  setIsSettingPrimary: (saving: boolean) => void;
}): Promise<void> {
  try {
    const result = await setPrimaryDomain(domainName);
    if (!result.success) {
      throw new Error(result.error);
    }
    toast({
      title: 'Success',
      description: 'Domain set as primary',
    });
    // revalidatePath in action should trigger update, but router.refresh() ensures client sees it
    router.refresh();
  } catch (error) {
    toast({
      title: 'Error',
      description:
        error instanceof Error ? error.message : 'Failed to set primary domain',
      variant: 'destructive',
    });
  } finally {
    setIsSettingPrimary(false);
  }
}

export function DomainCard({ domain }: DomainCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSettingPrimary, setIsSettingPrimary] = useState(false);
  const [pendingRecords, setPendingRecords] = useState<
    DomainVerificationRecord[]
  >([]);

  const getStatusBadge = (status: Domain['status']) => {
    const variants: Record<
      Domain['status'],
      {
        variant: 'default' | 'secondary' | 'destructive' | 'outline';
        label: string;
        icon: React.ComponentType<{ className?: string }>;
        className?: string;
      }
    > = {
      active: {
        variant: 'default',
        label: 'Active',
        icon: Check,
        className: 'bg-green-500 hover:bg-green-600',
      },
      pending: { variant: 'secondary', label: 'Pending', icon: Clock },
      verifying: { variant: 'secondary', label: 'Verifying', icon: Clock },
      failed: { variant: 'destructive', label: 'Failed', icon: AlertCircle },
      expired: { variant: 'destructive', label: 'Expired', icon: AlertCircle },
    };

    const config = variants[status];
    const Icon = config.icon;

    return (
      <Badge
        variant={config.variant}
        className={`flex items-center gap-1 ${config.className || ''}`}
      >
        <Icon className="size-3" />
        {config.label}
      </Badge>
    );
  };

  const getTypeBadge = (type: Domain['domain_type']) => {
    const labels = {
      subdomain: 'Free Subdomain',
      custom: 'Custom Domain',
      purchased: 'Purchased',
    };
    return <Badge variant="outline">{labels[type]}</Badge>;
  };

  const handleVerify = () => {
    setIsVerifying(true);
    return runVerifyDomain({
      domainName: domain.domain,
      toast,
      router,
      setIsVerifying,
      setPendingRecords,
    });
  };

  const handleDelete = () => {
    setIsDeleting(true);
    return runDeleteDomain({
      domainName: domain.domain,
      toast,
      router,
      setIsDeleting,
      setShowDeleteDialog,
    });
  };

  const handleSetPrimary = () => {
    setIsSettingPrimary(true);
    return runSetPrimaryDomain({
      domainName: domain.domain,
      toast,
      router,
      setIsSettingPrimary,
    });
  };

  const isVerifyActionAvailable =
    domain.domain_type === 'custom' && domain.status !== 'active';

  return (
    <>
      <Card
        className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg border-2 ${
          domain.status === 'active'
            ? 'border-green-200 dark:border-green-800 hover:border-green-300'
            : domain.status === 'failed'
              ? 'border-red-200 dark:border-red-800'
              : 'border-amber-200 dark:border-amber-800'
        }`}
      >
        {/* Status indicator bar at top */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            domain.status === 'active'
              ? 'bg-linear-to-r from-green-400 to-emerald-500'
              : domain.status === 'failed'
                ? 'bg-linear-to-r from-red-400 to-rose-500'
                : 'bg-linear-to-r from-amber-400 to-yellow-500'
          }`}
        />

        <CardHeader className="pb-3">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              {/* Domain Icon with status-based styling */}
              <div
                className={`shrink-0 w-14 h-14 rounded-xl flex items-center justify-center shadow-sm ${
                  domain.status === 'active'
                    ? 'bg-linear-to-br from-green-100 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/20'
                    : domain.status === 'failed'
                      ? 'bg-linear-to-br from-red-100 to-rose-50 dark:from-red-900/30 dark:to-rose-900/20'
                      : 'bg-linear-to-br from-amber-100 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/20'
                }`}
              >
                <Globe
                  className={`w-7 h-7 ${
                    domain.status === 'active'
                      ? 'text-green-600 dark:text-green-400'
                      : domain.status === 'failed'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400'
                  }`}
                />
              </div>

              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <span className="font-semibold">{domain.domain}</span>
                  {domain.is_primary && (
                    <Badge className="bg-linear-to-r from-indigo-500 to-purple-500 text-white border-0">
                      ⭐ Primary
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 mt-2">
                  {getTypeBadge(domain.domain_type)}
                  {getStatusBadge(domain.status)}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              {!domain.is_primary && domain.status === 'active' && (
                <Button
                  variant="default"
                  size="sm"
                  className="shadow-sm hover:shadow-md transition-shadow bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={handleSetPrimary}
                  disabled={isSettingPrimary}
                >
                  {isSettingPrimary ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    'Set Primary'
                  )}
                </Button>
              )}

              {isVerifyActionAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerify}
                  disabled={isVerifying}
                >
                  {isVerifying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    'Verify DNS'
                  )}
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More options">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!domain.is_primary && (
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-red-600 focus:text-red-600 focus:bg-red-50"
                    >
                      <Trash2 className="size-4 mr-2" />
                      Delete Domain
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      // Validate domain format and ensure https protocol
                      try {
                        const url = new URL(`https://${domain.domain}`);
                        if (
                          url.protocol === 'https:' ||
                          url.protocol === 'http:'
                        ) {
                          window.open(
                            url.href,
                            '_blank',
                            'noopener,noreferrer'
                          );
                        }
                      } catch {
                        // Invalid URL, don't open - show user feedback
                        toast({
                          title: 'Invalid URL',
                          description: 'Unable to open the domain URL.',
                          variant: 'destructive',
                        });
                      }
                    }}
                  >
                    <ExternalLink className="size-4 mr-2" />
                    Visit Site
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        {pendingRecords.length > 0 && (
          <CardContent className="pt-0">
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">
                Required DNS records to complete verification:
              </p>
              {pendingRecords.map((record) => (
                <div
                  key={`${record.type}-${record.name}-${record.value}`}
                  className="grid gap-1 rounded border bg-background p-2 font-mono"
                >
                  <div>
                    <span className="font-semibold">{record.type}</span>{' '}
                    <span className="break-all">{record.name}</span>
                  </div>
                  <div className="break-all text-muted-foreground">
                    {record.value}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Domain?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{domain.domain}</strong>?
              This action cannot be undone. Your site will no longer be
              accessible from this domain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
