'use client';

import { Globe, Loader2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiPost } from '@/lib/api-client';
import { STORE_SLUG_PATTERN } from '@/schemas/rename-slug';

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';

function sanitizeSlugInput(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      // A leading hyphen is never valid, so strip it as you type rather than
      // silently disabling the button with no explanation. (A trailing hyphen is
      // allowed mid-word; the button stays disabled until the pattern is valid.)
      .replace(/^-+/, '')
      .slice(0, 63)
  );
}

interface RenameSlugResponse {
  slug: string;
  url: string;
}

/**
 * "Change store URL" — the sanctioned way for a merchant to rename their
 * storefront slug. Calls POST /api/merchant/rename-slug (which invokes the
 * rename_merchant_slug RPC). The old URL keeps working via a 301 alias, so the
 * confirmation copy reassures rather than alarms.
 */
export function ChangeStoreUrl() {
  const { merchant } = useMerchant();
  const { toast } = useToast();

  const currentSlug = merchant?.slug ?? '';
  const merchantId = merchant?.id ?? '';
  // Dashboard context supplies only the primary active custom domain.
  const customDomain = merchant?.custom_domain?.trim();
  const baciAddress = `${currentSlug}.${ROOT_DOMAIN}`;

  const [nextSlug, setNextSlug] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trimmed = nextSlug.trim();
  const isValid = trimmed.length >= 3 && STORE_SLUG_PATTERN.test(trimmed);
  const isUnchanged = trimmed === currentSlug;
  const canSubmit =
    isValid && !isUnchanged && !isRenaming && Boolean(merchantId);

  const handleRename = async () => {
    setConfirmOpen(false);
    setIsRenaming(true);
    try {
      const result = await apiPost<RenameSlugResponse>(
        '/api/merchant/rename-slug',
        { merchantId, new_slug: trimmed }
      );
      toast({
        title: 'Store URL changed',
        description: `Your store is now at ${result.url.replace(
          /^https?:\/\//,
          ''
        )}. The old link redirects here automatically.`,
      });
      setNextSlug('');
      // The rename response is scoped to the captured merchant. Do not reload
      // whichever merchant happens to be selected after this request finishes.
    } catch (error) {
      toast({
        title: 'Could not change URL',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-5" />
          Store URL
        </CardTitle>
        <CardDescription>
          {customDomain
            ? 'Your custom domain is active. Changing your Baci subdomain does not change your custom domain.'
            : 'Your storefront address. Changing it keeps the old link working — it redirects to the new one automatically.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-sm text-muted-foreground">Current URL</span>
          <p className="font-medium break-all">{customDomain || baciAddress}</p>
        </div>
        {customDomain && (
          <div className="space-y-1.5">
            <span className="text-sm text-muted-foreground">
              Baci subdomain
            </span>
            <p className="font-medium break-all">{baciAddress}</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="new-store-url">
            {customDomain ? 'New Baci subdomain' : 'New URL'}
          </Label>
          <div className="flex items-stretch overflow-hidden rounded-md border focus-within:ring-1 focus-within:ring-ring">
            <Input
              id="new-store-url"
              value={nextSlug}
              onChange={(event) =>
                setNextSlug(sanitizeSlugInput(event.target.value))
              }
              placeholder={currentSlug}
              className="rounded-none border-0 focus-visible:ring-0"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="new-store-url-hint"
            />
            <span className="flex items-center whitespace-nowrap bg-muted/50 px-3 text-sm text-muted-foreground">
              .{ROOT_DOMAIN}
            </span>
          </div>
          <p id="new-store-url-hint" className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens. Minimum 3 characters.
          </p>
        </div>

        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => setConfirmOpen(true)}
        >
          {isRenaming ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Changing…
            </>
          ) : (
            'Change URL'
          )}
        </Button>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change your store URL?</AlertDialogTitle>
              <AlertDialogDescription>
                {customDomain
                  ? 'Your Baci subdomain will change from '
                  : 'Your store will move from '}
                <strong>
                  {currentSlug}.{ROOT_DOMAIN}
                </strong>{' '}
                to{' '}
                <strong>
                  {trimmed}.{ROOT_DOMAIN}
                </strong>
                . The old address redirects automatically, but update any
                printed links, QR codes, or ads where you can. You can change it
                again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRenaming}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={handleRename} disabled={isRenaming}>
                Change URL
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
