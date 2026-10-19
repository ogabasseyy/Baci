import * as Sentry from '@sentry/react-native';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { recordPerformanceSurface } from '@/lib/performance-attribution';

let nextGadgetPatternId = 0;

export function useGadgetPatternAttribution(
  rendered: boolean,
  variant: 'default' | 'tabbar'
): void {
  const instanceId = useRef(`gadget_pattern_${nextGadgetPatternId++}`);

  useEffect(() => {
    if (!rendered) return;

    const endTrace = recordPerformanceSurface('gadget_pattern', {
      api_level:
        Platform.OS === 'android' ? Number(Platform.Version) : undefined,
      instance_id: instanceId.current,
      os: Platform.OS,
      renderer: 'raster_gradient',
      variant,
    });

    const details = {
      api_level:
        Platform.OS === 'android' ? Number(Platform.Version) : undefined,
      os: Platform.OS,
      renderer: 'raster_gradient',
      variant,
    };
    return () => {
      endTrace?.();
      recordCrashBreadcrumb(`gadget_pattern:unmounted:${instanceId.current}`, {
        ...details,
        instance_id: instanceId.current,
      });
      Sentry.addBreadcrumb({
        category: 'performance.surface',
        data: { ...details, instance_id: instanceId.current },
        level: 'info',
        message: `gadget_pattern:unmounted:${variant}:${instanceId.current}`,
      });
    };
  }, [rendered, variant]);
}
