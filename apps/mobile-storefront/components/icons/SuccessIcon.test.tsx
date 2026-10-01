import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import { Circle, Path } from 'react-native-svg';
import { SuccessIcon } from './SuccessIcon';

describe('SuccessIcon Android ANR regression', () => {
  it('renders SVG strokes without per-frame animated props', () => {
    const screen = render(<SuccessIcon />);
    const svgStrokes = [
      ...screen.UNSAFE_getAllByType(Circle),
      ...screen.UNSAFE_getAllByType(Path),
    ];

    expect(svgStrokes).not.toHaveLength(0);
    for (const stroke of svgStrokes) {
      expect(stroke.props.animatedProps).toBeUndefined();
    }
  });

  it('preserves custom size and color', () => {
    const screen = render(<SuccessIcon size={48} color="#123456" />);
    const container = screen.UNSAFE_getByType(View);
    const svgStrokes = [
      ...screen.UNSAFE_getAllByType(Circle),
      ...screen.UNSAFE_getAllByType(Path),
    ];

    expect(container.props.style).toContainEqual({ width: 48, height: 48 });
    for (const stroke of svgStrokes) {
      expect(stroke.props.stroke).toBe('#123456');
    }
  });
});
