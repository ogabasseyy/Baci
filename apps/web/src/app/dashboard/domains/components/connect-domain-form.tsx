'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import z from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import type {
  DomainLifecycleState,
  DomainVerificationRecord,
} from '@/schemas/cloudflare-saas';

// Domain validation schema
const domainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i,
      'Invalid domain format (e.g., example.com)'
    )
    .transform((val) => val.trim().toLowerCase()),
});

type DomainFormValues = z.infer<typeof domainSchema>;

interface OnboardingState {
  domain: string;
  lifecycleState: DomainLifecycleState;
  verificationRecords: DomainVerificationRecord[];
}

const LIFECYCLE_LABELS: Record<DomainLifecycleState, string> = {
  provisioning: 'Provisioning',
  pending_verification: 'Pending DNS Verification',
  verifying_routing: 'Verifying Routing',
  active: 'Active',
  deleting: 'Deleting',
  deleting_reconciling: 'Finalizing Deletion',
};

function normalizeRecordsFromResponse(
  domain: string,
  result: {
    verificationRecords?: DomainVerificationRecord[];
    verification?: { type?: string; name?: string; value?: string };
  }
): DomainVerificationRecord[] {
  if (
    Array.isArray(result.verificationRecords) &&
    result.verificationRecords.length > 0
  ) {
    return result.verificationRecords;
  }
  if (result.verification?.value) {
    return [
      {
        name: result.verification.name ?? '@',
        purpose: 'routing',
        status: 'pending',
        type:
          result.verification.type === 'CNAME'
            ? 'CNAME'
            : result.verification.type === 'TXT'
              ? 'TXT'
              : 'A',
        value: result.verification.value,
      },
    ];
  }
  return [
    {
      name: domain,
      purpose: 'routing',
      status: 'pending',
      type: 'CNAME',
      value: 'customers.usebaci.com',
    },
  ];
}

export function ConnectDomainForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [onboardingState, setOnboardingState] =
    useState<OnboardingState | null>(null);
  const [isRefreshingRecords, setIsRefreshingRecords] = useState(false);

  const form = useForm<DomainFormValues>({
    resolver: zodResolver(domainSchema),
    defaultValues: { domain: '' },
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: 'Copied!',
        description: 'DNS record value copied to clipboard.',
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast({
        title: 'Failed to copy',
        description: 'Please copy the value manually.',
        variant: 'destructive',
      });
    }
  };

  const refreshVerificationRecords = async (domain: string) => {
    setIsRefreshingRecords(true);
    try {
      const response = await fetch(
        `/api/domains/${encodeURIComponent(domain)}/verification`
      );
      if (!response.ok) {
        toast({
          title: 'Refresh failed',
          description: 'Could not refresh DNS verification records.',
          variant: 'destructive',
        });
        return;
      }
      const data = await response.json();
      setOnboardingState({
        domain: data.domain ?? domain,
        lifecycleState: data.lifecycleState ?? 'pending_verification',
        verificationRecords: normalizeRecordsFromResponse(domain, data),
      });
    } catch (error) {
      console.error('Error refreshing DNS records:', error);
      toast({
        title: 'Refresh failed',
        description: 'An error occurred while refreshing DNS records.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshingRecords(false);
    }
  };

  const onSubmit = async (data: DomainFormValues) => {
    setOnboardingState(null);

    try {
      const response = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: data.domain,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        const resolvedDomain = result.domain?.domain ?? data.domain;
        const lifecycleState: DomainLifecycleState =
          result.lifecycleState ??
          (response.status === 202 ? 'provisioning' : 'pending_verification');

        toast({
          title:
            response.status === 202
              ? 'Domain Provisioning Started'
              : 'Domain Added!',
          description:
            response.status === 202
              ? 'DNS verification records are being prepared. Refresh shortly if TXT records are still loading.'
              : 'Your custom domain has been added. Add the DNS records below to verify.',
        });

        setOnboardingState({
          domain: resolvedDomain,
          lifecycleState,
          verificationRecords: normalizeRecordsFromResponse(
            resolvedDomain,
            result
          ),
        });

        form.reset();
        router.refresh();
      } else {
        toast({
          title: 'Failed to Add Domain',
          description:
            result.error || 'Could not add domain. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error adding domain:', error);
      toast({
        title: 'Error',
        description: 'An error occurred while adding the domain.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Existing Domain</CardTitle>
        <CardDescription>
          Enter the domain name you own (e.g., example.com) to connect it to
          your store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
            <FormField
              control={form.control}
              name="domain"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder="example.com"
                      {...field}
                      disabled={form.formState.isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <Plus className="size-4 mr-2" />
                  Connect
                </>
              )}
            </Button>
          </form>
        </Form>

        {onboardingState && (
          <Alert>
            <div className="flex items-center justify-between gap-2 mb-2">
              <AlertTitle className="mb-0">
                DNS Verification for {onboardingState.domain}
              </AlertTitle>
              <Badge variant="secondary">
                {LIFECYCLE_LABELS[onboardingState.lifecycleState]}
              </Badge>
            </div>
            <AlertDescription className="space-y-3">
              <p>
                Add all required DNS records below at your DNS provider. If TXT
                records are still provisioning, refresh this list without
                re-submitting the domain.
              </p>
              <div className="space-y-2">
                {onboardingState.verificationRecords.map((record) => (
                  <div
                    key={`${record.type}-${record.name}-${record.value}`}
                    className="grid gap-1.5 p-3 bg-background rounded border text-sm"
                  >
                    <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <span className="font-semibold text-muted-foreground">
                        Type:
                      </span>
                      <span className="font-mono">{record.type}</span>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <span className="font-semibold text-muted-foreground">
                        Host:
                      </span>
                      <code className="break-all font-mono">{record.name}</code>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                      <span className="font-semibold text-muted-foreground">
                        Value:
                      </span>
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-1 py-0.5 rounded break-all">
                          {record.value}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => copyToClipboard(record.value)}
                        >
                          <Copy className="size-3" />
                          <span className="sr-only">Copy value</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  DNS changes can take a few minutes to propagate.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isRefreshingRecords}
                  onClick={() =>
                    refreshVerificationRecords(onboardingState.domain)
                  }
                >
                  <RefreshCw
                    className={`size-3.5 mr-1.5 ${isRefreshingRecords ? 'animate-spin' : ''}`}
                  />
                  Refresh DNS Records
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
