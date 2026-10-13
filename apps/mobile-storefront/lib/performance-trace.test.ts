import { Platform } from 'react-native';
import BaciPerformanceTrace from '../modules/baci-performance-trace';
import { beginPerformanceTrace } from './performance-trace';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../modules/baci-performance-trace', () => ({
  __esModule: true,
  default: {
    beginAsyncSection: jest.fn(() => 41),
    endAsyncSection: jest.fn(),
  },
}));

const mockNativeTrace = BaciPerformanceTrace as jest.Mocked<
  NonNullable<typeof BaciPerformanceTrace>
>;

describe('beginPerformanceTrace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    mockNativeTrace.beginAsyncSection.mockReturnValue(41);
  });

  it('does nothing outside Android', () => {
    Platform.OS = 'ios';

    const endTrace = beginPerformanceTrace('home', { focused: true });
    endTrace();

    expect(mockNativeTrace.beginAsyncSection).not.toHaveBeenCalled();
    expect(mockNativeTrace.endAsyncSection).not.toHaveBeenCalled();
  });

  it('marks a privacy-safe surface lifetime in an active Android trace', () => {
    Platform.OS = 'android';

    const endTrace = beginPerformanceTrace('gadget_pattern', {
      api_level: 31,
      customer_email: 'customer@example.com',
      instance_id: 'gadget_pattern_2',
      renderer: 'raster_gradient',
    });
    endTrace();
    endTrace();

    expect(mockNativeTrace.beginAsyncSection).toHaveBeenCalledWith(
      'baci.surface.gadget_pattern|api_level=31;instance_id=gadget_pattern_2;renderer=raster_gradient'
    );
    expect(mockNativeTrace.endAsyncSection).toHaveBeenCalledTimes(1);
    expect(mockNativeTrace.endAsyncSection).toHaveBeenCalledWith(
      'baci.surface.gadget_pattern|api_level=31;instance_id=gadget_pattern_2;renderer=raster_gradient',
      41
    );
  });

  it('does nothing when Android system tracing is not recording', () => {
    Platform.OS = 'android';
    mockNativeTrace.beginAsyncSection.mockReturnValueOnce(null);

    const endTrace = beginPerformanceTrace('home', { focused: true });
    endTrace();

    expect(mockNativeTrace.endAsyncSection).not.toHaveBeenCalled();
  });
});
