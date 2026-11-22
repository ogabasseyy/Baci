import type { NextResponse } from 'next/server';
import { generateStorefrontCspReportOnlyCandidate } from './csp';

export function applyStorefrontCspReportOnlyPreviewHeader(
  response: Pick<NextResponse, 'headers'>,
  csp: string,
  routeType: 'admin' | 'auth' | 'storefront' | 'api',
  isLocal: boolean
): void {
  if (
    routeType !== 'storefront' ||
    !isLocal ||
    process.env.NODE_ENV === 'production' ||
    process.env.BACI_CSP_REPORT_ONLY_PREVIEW !== 'true'
  ) {
    return;
  }

  const candidate = generateStorefrontCspReportOnlyCandidate(csp);
  if (candidate) {
    response.headers.set('Content-Security-Policy-Report-Only', candidate);
  }
}
