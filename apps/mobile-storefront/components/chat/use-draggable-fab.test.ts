import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useDraggableFab } from './use-draggable-fab';

type PanEvent = {
  translationX: number;
  translationY: number;
  velocityX: number;
  velocityY: number;
};

type PanGestureConfig = {
  onBegin: () => void;
  onDeactivate: (event: PanEvent) => void;
  onFinalize: () => void;
  onUpdate: (event: PanEvent) => void;
};

type TapGestureConfig = {
  onActivate: () => void;
};

let mockPanGestureConfig: PanGestureConfig | null = null;
let mockTapGestureConfig: TapGestureConfig | null = null;

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
  },
  impactAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/optional-gesture-handler', () => ({
  getOptionalGestureHandlerRuntime: () => ({
    usePanGesture: jest.fn((config: PanGestureConfig) => {
      mockPanGestureConfig = config;
      return { gesture: 'pan' };
    }),
    useSimultaneousGestures: jest.fn(() => ({ gesture: 'simultaneous' })),
    useTapGesture: jest.fn((config: TapGestureConfig) => {
      mockTapGestureConfig = config;
      return { gesture: 'tap' };
    }),
  }),
}));

describe('useDraggableFab', () => {
  beforeEach(() => {
    mockPanGestureConfig = null;
    mockTapGestureConfig = null;
  });

  it('returns the expected properties', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current).toHaveProperty('composedGesture');
    expect(result.current).toHaveProperty('translateX');
    expect(result.current).toHaveProperty('translateY');
    expect(result.current).toHaveProperty('isDragging');
    expect(result.current).toHaveProperty('isOverDismissZone');
    expect(result.current).toHaveProperty('isOnRight');
  });

  it('isDragging is initially false', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current.isDragging).toBe(false);
  });

  it('isOverDismissZone is initially false', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current.isOverDismissZone).toBe(false);
  });

  it('does not start a continuously animated scale value while idle', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current).not.toHaveProperty('scale');
  });

  it('translateX and translateY start at 0', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current.translateX.value).toBe(0);
    expect(result.current.translateY.value).toBe(0);
  });

  it('isOnRight is initially true', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(result.current.isOnRight).toBe(true);
  });

  it('updates drag state and translations from pan gesture callbacks', () => {
    const { result } = renderHook(() => useDraggableFab(90));

    expect(mockPanGestureConfig).toBeTruthy();

    act(() => {
      mockPanGestureConfig?.onBegin();
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      mockPanGestureConfig?.onUpdate({
        translationX: -40,
        translationY: 24,
        velocityX: 0,
        velocityY: 0,
      });
    });
    expect(result.current.translateX.value).toBe(-40);
    expect(result.current.translateY.value).toBe(24);

    act(() => {
      mockPanGestureConfig?.onFinalize();
    });
    expect(result.current.isDragging).toBe(false);
  });

  it('invokes onPress from the tap gesture callback', () => {
    const onPress = jest.fn();
    renderHook(() => useDraggableFab(90, undefined, onPress));

    expect(mockTapGestureConfig).toBeTruthy();

    act(() => {
      mockTapGestureConfig?.onActivate();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
