import { renderHook } from '@testing-library/react-native';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { recordPerformanceSurface } from '@/lib/performance-attribution';
import { useGadgetPatternAttribution } from './use-gadget-pattern-attribution';

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: jest.fn(),
}));
jest.mock('@/lib/performance-attribution', () => ({
  recordPerformanceSurface: jest.fn(),
}));

describe('useGadgetPatternAttribution', () => {
  it('does not attribute skipped patterns', () => {
    renderHook(() => useGadgetPatternAttribution(false, 'default'));
    expect(recordPerformanceSurface).not.toHaveBeenCalled();
  });

  it('attributes rendered patterns and marks their unmount', () => {
    const endTrace = jest.fn();
    jest.mocked(recordPerformanceSurface).mockReturnValueOnce(endTrace);

    const { unmount } = renderHook(() =>
      useGadgetPatternAttribution(true, 'tabbar')
    );
    unmount();

    expect(recordPerformanceSurface).toHaveBeenCalledWith(
      'gadget_pattern',
      expect.objectContaining({
        os: expect.any(String),
        renderer: 'raster_gradient',
        variant: 'tabbar',
      })
    );
    expect(endTrace).toHaveBeenCalledTimes(1);
    expect(recordCrashBreadcrumb).toHaveBeenCalledWith(
      expect.stringMatching(/^gadget_pattern:unmounted:gadget_pattern_/),
      expect.objectContaining({
        variant: 'tabbar',
        instance_id: expect.any(String),
      })
    );
  });
});
