import * as Sentry from '@sentry/react-native';
import { trackEvent } from '@/services/analytics';
import { recordCrashBreadcrumb } from './crash-diagnostics';
import { beginPerformanceTrace } from './performance-trace';

export type PerformanceSurface = 'gadget_pattern' | 'home';

export function recordPerformanceSurface(
  surface: PerformanceSurface,
  details: Record<string, unknown> = {}
): () => void {
  const properties = { ...details, surface };
  recordCrashBreadcrumb(`performance:surface:${surface}`, properties);
  Sentry.addBreadcrumb({
    category: 'performance.surface',
    data: properties,
    level: 'info',
    message: surface,
  });
  trackEvent('performance_surface_attributed', properties);
  return beginPerformanceTrace(surface, properties);
}
