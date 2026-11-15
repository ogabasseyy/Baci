import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { ShortcutTileBackdrop } from './ShortcutTileBackdrop';

it.each([
  { shortEdgesOnly: false, fillCount: 35, color: '#181416' },
  { shortEdgesOnly: true, fillCount: 11, color: '#ffffff' },
])('fills the center and scallops (short edges only: $shortEdgesOnly)', ({
  shortEdgesOnly,
  fillCount,
  color,
}) => {
  render(
    <ShortcutTileBackdrop color={color} shortEdgesOnly={shortEdgesOnly} />
  );
  const views = screen.UNSAFE_getAllByType(View);
  const fills = views.filter(
    (view) => StyleSheet.flatten(view.props.style)?.backgroundColor === color
  );
  expect(fills).toHaveLength(fillCount);
  expect(views[0]?.props.pointerEvents).toBe('none');
});
