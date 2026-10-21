'use client';

import { useEffect, useRef } from 'react';
import {
  getChunkLoadRecoveryOutcome,
  useChunkLoadRecoveryBoundary,
} from '@/hooks/use-chunk-load-recovery-boundary';

interface BoundaryErrorReportOptions {
  routeSurface: string;
  logLabel: string;
  properties?: Record<string, unknown>;
}

/**
 * Shared error-boundary pipeline: hands the caught error to chunk-load
 * recovery, then reports it to PostHog exactly once per error instance with
 * the recovery outcome attached. This hook always reports; the PostHog
 * `before_send` chain (dropRecoveredChunkExceptionCapture) is the single
 * place that drops chunk-failure captures while a recovery reload is
 * actually navigating — those reloads stay observable via the
 * `chunk_load_recovery` telemetry event. Returns true while a recovery
 * reload is pending so the boundary can render a refresh notice instead of
 * the failure card.
 */
export function useBoundaryErrorReport(
  error: Error & { digest?: string },
  options: BoundaryErrorReportOptions
): boolean {
  const recovering = useChunkLoadRecoveryBoundary(error);
  const reportedErrorRef = useRef<unknown>(undefined);

  useEffect(() => {
    if (reportedErrorRef.current === error) {
      return;
    }
    reportedErrorRef.current = error;

    // The recovery hook's effect registered first, so by the time this runs
    // the actual commit outcome is recorded; fall back to the render-time
    // peek only when no outcome exists (non-object throws).
    const reloadScheduled = getChunkLoadRecoveryOutcome(error) ?? recovering;
    const reportProperties = {
      ...options.properties,
      // Reserved reporting fields always win over caller-supplied properties.
      digest: error.digest,
      recovery_action: reloadScheduled ? 'reload-scheduled' : 'none',
      route_surface: options.routeSurface,
    };

    console.error(`${options.logLabel}:`, error);
    void import('@/lib/posthog/client-exceptions')
      .then(({ captureClientException }) => {
        captureClientException(error, reportProperties);
      })
      .catch(() => {
        // Best-effort telemetry must never fail inside an error boundary.
      });
  }, [error, recovering, options]);

  return recovering;
}
