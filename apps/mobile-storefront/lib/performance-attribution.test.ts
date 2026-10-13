import { trackEvent } from '@/services/analytics';
import { recordCrashBreadcrumb } from './crash-diagnostics';
import { recordPerformanceSurface } from './performance-attribution';
import { beginPerformanceTrace } from './performance-trace';

jest.mock('./crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('./performance-trace', () => ({
  beginPerformanceTrace: jest.fn(() => jest.fn()),
}));

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn() }));

describe('performance attribution', () => {
  it('stamps the same bounded surface context into crash and analytics telemetry', () => {
    const endTrace = jest.fn();
    jest.mocked(beginPerformanceTrace).mockReturnValueOnce(endTrace);

    const cleanup = recordPerformanceSurface('gadget_pattern', {
      api_level: 28,
      os: 'android',
      variant: 'hero',
    });

    expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
      'performance:surface:gadget_pattern',
      {
        api_level: 28,
        os: 'android',
        surface: 'gadget_pattern',
        variant: 'hero',
      }
    );
    expect(trackEvent).toHaveBeenCalledWith('performance_surface_attributed', {
      api_level: 28,
      os: 'android',
      surface: 'gadget_pattern',
      variant: 'hero',
    });
    expect(beginPerformanceTrace).toHaveBeenCalledWith('gadget_pattern', {
      api_level: 28,
      os: 'android',
      surface: 'gadget_pattern',
      variant: 'hero',
    });
    cleanup?.();
    expect(endTrace).toHaveBeenCalledTimes(1);
  });
});
