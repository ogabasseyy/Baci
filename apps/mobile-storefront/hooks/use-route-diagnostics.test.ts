import { jest } from '@jest/globals';
import * as Sentry from '@sentry/react-native';
import { renderHook } from '@testing-library/react-native';
import { useRouteDiagnostics } from './use-route-diagnostics';

const mockSegments = jest.fn<() => string[]>();
jest.mock('expo-router', () => ({ useSegments: () => mockSegments() }));
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  setTag: jest.fn(),
}));

describe('route diagnostics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records route patterns and transitions without resolved IDs or query parameters', () => {
    mockSegments.mockReturnValue(['(tabs)']);
    const { rerender } = renderHook(() => useRouteDiagnostics());
    mockSegments.mockReturnValue(['product', '[slug]']);
    rerender({});
    expect(Sentry.setTag).toHaveBeenLastCalledWith('route', '/product/[slug]');
    expect(Sentry.addBreadcrumb).toHaveBeenLastCalledWith({
      category: 'navigation',
      message: 'route_changed',
      level: 'info',
      data: { from: '/(tabs)', to: '/product/[slug]' },
    });
    rerender({});
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(2);
  });

  it('does not interrupt rendering when native telemetry fails', () => {
    mockSegments.mockReturnValue(['checkout']);
    jest.mocked(Sentry.setTag).mockImplementationOnce(() => {
      throw new Error('native unavailable');
    });
    expect(() => renderHook(() => useRouteDiagnostics())).not.toThrow();
  });
});
