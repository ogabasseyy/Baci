import { fetchWithCsrf } from '@/lib/api-client';
import { stripHtmlTags } from '@/lib/sanitize-core';
import { resolveJumiaLabelUrl } from './resolve-jumia-label-url';

export type JumiaOrderAction =
  | 'pack'
  | 'ready_to_ship'
  | 'print_label'
  | 'cancel';

type ActionResponse = {
  error?: string;
  message?: string;
  status?: 'full' | 'partial' | 'failed';
  successCount?: number;
  errorCount?: number;
  labels?: Array<{ label?: string }>;
};

type ActionCallbacks = {
  setLabelUrls: (value: string[]) => void;
  setBlockedLabelUrl: (value: string | null) => void;
  setActionLoading: (value: string | null) => void;
  refetch: () => void;
  toast: (options: {
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
  }) => void;
};

export async function runJumiaOrderAction(
  action: JumiaOrderAction,
  orderId: string,
  integrationId: string,
  itemIds: string[],
  {
    setLabelUrls,
    setBlockedLabelUrl,
    setActionLoading,
    refetch,
    toast,
  }: ActionCallbacks
): Promise<void> {
  setLabelUrls([]);
  setBlockedLabelUrl(null);
  setActionLoading(action);
  try {
    const res = await fetchWithCsrf('/api/marketplace/jumia/actions', {
      method: 'POST',
      body: JSON.stringify({
        action,
        integrationId,
        orderId,
        itemIds,
      }),
    });

    let data: ActionResponse;
    let jsonParsed = true;
    const text = await res.text();
    try {
      data = JSON.parse(text) as ActionResponse;
    } catch {
      jsonParsed = false;
      const MAX_RAW_LENGTH = 200;
      const sanitized = stripHtmlTags(text).slice(0, MAX_RAW_LENGTH);
      data = { error: sanitized };
    }

    if (!res.ok) throw new Error(data.error || 'Action failed');

    // Treat non-JSON 200 responses as failures.
    if (!jsonParsed) {
      throw new Error(
        data.error || 'Server returned an unexpected non-JSON response'
      );
    }

    if (action !== 'print_label') {
      // The actions route answers HTTP 200 with per-item totals; every
      // item can fail while the transport succeeds.
      if (data.status === 'failed') {
        toast({
          title: 'Action Failed',
          description:
            data.message ||
            'Jumia rejected every item; nothing was packed, shipped, or cancelled.',
          variant: 'destructive',
        });
        return;
      }
      if (data.status === 'partial') {
        toast({
          title: 'Partial Success',
          description:
            data.message ||
            `${data.successCount ?? 0} succeeded, ${data.errorCount ?? 0} failed.`,
          variant: 'destructive',
        });
        refetch();
        return;
      }
      toast({
        title: 'Success',
        description: data.message || 'Action completed',
      });
      refetch();
      return;
    }

    if (!data.labels || data.labels.length === 0) {
      toast({
        title: 'No Labels',
        description: data.labels
          ? 'No labels were generated for this order.'
          : 'No labels returned for this order.',
      });
      refetch();
      return;
    }

    const validLabels = data.labels.flatMap((entry) => {
      const labelUrl = resolveJumiaLabelUrl(entry.label);
      return labelUrl ? [{ label: labelUrl }] : [];
    });

    if (validLabels.length === 0) {
      toast({
        title: 'No Valid Labels',
        description: 'No valid printable labels were returned.',
        variant: 'destructive',
      });
      refetch();
      return;
    }

    if (validLabels.length === 1) {
      const popup = window.open(
        validLabels[0].label,
        '_blank',
        'noopener,noreferrer'
      );
      if (!popup) {
        setBlockedLabelUrl(validLabels[0].label);
      }
    }

    setLabelUrls(validLabels.map((entry) => entry.label));
    const count = validLabels.length;
    toast({
      title: 'Labels Generated',
      description: `${count} label${count === 1 ? '' : 's'} ready`,
    });
    refetch();
  } catch (err: unknown) {
    toast({
      title: 'Action Failed',
      description: err instanceof Error ? err.message : 'Unknown error',
      variant: 'destructive',
    });
  } finally {
    setActionLoading(null);
  }
}
