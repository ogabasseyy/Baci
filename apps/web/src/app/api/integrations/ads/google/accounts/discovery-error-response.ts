import { NextResponse } from 'next/server';
import {
  GOOGLE_ADS_DISCOVERY_LIMIT_CODES,
  GoogleAdsProviderError,
} from '@/lib/google-ads/provider';

export function accountDiscoveryErrorResponse(error: unknown): NextResponse {
  if (
    error instanceof GoogleAdsProviderError &&
    GOOGLE_ADS_DISCOVERY_LIMIT_CODES.some((code) => code === error.code)
  ) {
    return NextResponse.json(
      { error: error.code, retry: true },
      { status: 502 }
    );
  }
  return NextResponse.json(
    { error: 'Failed to discover Google Ads accounts' },
    { status: 502 }
  );
}
