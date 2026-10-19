'use client';

import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface GoogleAdsReportingUnavailableProps {
  error?: string;
  onRetry?: () => void;
}

export function GoogleAdsReportingUnavailable({
  error,
  onRetry,
}: GoogleAdsReportingUnavailableProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertDescription>
        <p>{error ?? 'Google Ads reporting is temporarily unavailable.'}</p>
        {onRetry && (
          <Button
            className="mt-2"
            onClick={onRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw className="size-4" />
            Retry Google Ads reporting
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
