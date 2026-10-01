'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GOOGLE_ADS_CONNECT_PATH } from './google-ads-connect-path';

interface GoogleAdsConnectButtonProps {
  label?: string;
  merchantId?: string;
}

export function GoogleAdsConnectButton({
  label = 'Connect Google Ads',
  merchantId,
}: GoogleAdsConnectButtonProps) {
  const href = merchantId
    ? `${GOOGLE_ADS_CONNECT_PATH}?merchantId=${encodeURIComponent(merchantId)}`
    : GOOGLE_ADS_CONNECT_PATH;
  return (
    <Button asChild size="sm" className="gap-2">
      <a href={href}>
        {label}
        <ExternalLink className="size-4" />
      </a>
    </Button>
  );
}
