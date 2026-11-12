import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';

const mockSnapPoints: unknown[] = [];
jest.mock('@gorhom/bottom-sheet', () => {
  const { forwardRef } = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: forwardRef(
      (props: { snapPoints: unknown; children: unknown }, _ref: unknown) => {
        mockSnapPoints.push(props.snapPoints);
        return <View>{props.children as never}</View>;
      }
    ),
    BottomSheetBackdrop: () => null,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 50, bottom: 34, left: 0, right: 0 }),
}));

function renderSheet(contentHeight?: number) {
  mockSnapPoints.length = 0;
  render(
    <SavingsBottomSheet
      colors={Colors.light}
      contentHeight={contentHeight}
      onClose={jest.fn()}
      snapPoints={['64%', '92%']}
      visible
    >
      <Text>content</Text>
    </SavingsBottomSheet>
  );
  return mockSnapPoints.at(-1);
}

// Owner feedback 2026-11-12: the savings sheet ended in empty space because it
// always opened at a fixed share of the screen.
describe('bugfix: savings sheet left empty space below short content', () => {
  it('opens exactly as tall as the measured content plus handle and safe area', () => {
    // 300 content + 32 handle and top padding + 34 bottom safe area.
    expect(renderSheet(300)).toEqual([366]);
  });

  it('never grows past nearly full screen for tall content', () => {
    const [height] = renderSheet(5000) as number[];
    expect(height).toBeLessThan(5000);
  });

  it('keeps the given heights until the content is measured', () => {
    expect(renderSheet()).toEqual(['64%', '92%']);
    expect(renderSheet(0)).toEqual(['64%', '92%']);
  });
});
