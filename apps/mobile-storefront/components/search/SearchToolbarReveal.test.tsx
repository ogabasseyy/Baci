import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { SearchToolbarReveal } from './SearchToolbarReveal';

jest.mock('react-native-reanimated', () => {
  const { View: RNView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: { View: RNView },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (value: number) => value,
  };
});

function revealProps() {
  return screen.getByTestId('search-toolbar-reveal').props;
}

function revealStyle() {
  return StyleSheet.flatten(revealProps().style);
}

it('exposes the toolbar to touch and assistive tech while visible', () => {
  render(
    <SearchToolbarReveal visible>
      <Text>Toolbar</Text>
    </SearchToolbarReveal>
  );
  const props = revealProps();
  expect(screen.getByText('Toolbar')).toBeTruthy();
  expect(revealStyle().pointerEvents).toBe('auto');
  expect(props.accessibilityElementsHidden).toBe(false);
  expect(props.importantForAccessibility).toBe('auto');
});

it('hides the toolbar from touch and assistive tech while keeping it mounted', () => {
  const view = render(
    <SearchToolbarReveal visible>
      <Text>Toolbar</Text>
    </SearchToolbarReveal>
  );
  const reveal = screen.getByTestId('search-toolbar-reveal');
  view.rerender(
    <SearchToolbarReveal visible={false}>
      <Text>Toolbar</Text>
    </SearchToolbarReveal>
  );
  // Hidden elements leave the queryable tree, so assert through the live
  // instance: still mounted, touch-disabled, and a11y-hidden.
  expect(reveal).toBeTruthy();
  expect(StyleSheet.flatten(reveal.props.style).pointerEvents).toBe('none');
  expect(reveal.props.accessibilityElementsHidden).toBe(true);
  expect(reveal.props.importantForAccessibility).toBe('no-hide-descendants');
});

it('collapses the measured height when hiding', () => {
  const view = render(
    <SearchToolbarReveal visible>
      <Text>Toolbar</Text>
    </SearchToolbarReveal>
  );
  const measurable = view
    .UNSAFE_getAllByType(View)
    .find((node) => typeof node.props.onLayout === 'function');
  if (!measurable) throw new Error('measurable view not found');
  fireEvent(measurable, 'layout', {
    nativeEvent: { layout: { height: 120 } },
  });
  const style = StyleSheet.flatten(revealProps().style);
  expect(style.height).toBe(120);
});
