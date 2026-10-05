import type { SearchRefinements } from '@baci/shared/lib';
import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { Pressable, Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SearchRefinementFields } from './SearchRefinementFields';

const draft: SearchRefinements = { brands: [], sort: 'relevance' };
const props: ComponentProps<typeof SearchRefinementFields> = {
  brands: ['Apple', 'Samsung'],
  categories: [],
  processors: ['M1'],
  conditions: ['used'],
  draft,
  setDraft: jest.fn(),
  minimum: '',
  maximum: '',
  setMinimum: jest.fn(),
  setMaximum: jest.fn(),
  brandQuery: '',
  setBrandQuery: jest.fn(),
  setError: jest.fn(),
  colors: Colors.light,
  positions: { current: {} },
  action: (label, onPress, selected, role = 'button', key = label) => (
    <Pressable
      key={key}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <Text>{label}</Text>
    </Pressable>
  ),
};
beforeEach(() => jest.clearAllMocks());
it('expands one section and calls the price draft callbacks', () => {
  const view = render(<SearchRefinementFields {...props} />);
  expect(
    view.getByLabelText('Price options').props.accessibilityState.expanded
  ).toBe(true);
  fireEvent.changeText(view.getByLabelText('Minimum price (₦)'), '100');
  expect(props.setMinimum).toHaveBeenCalledWith('100');
  expect(props.setError).toHaveBeenCalledWith(null);
  fireEvent.press(view.getByLabelText('Brand options'));
  expect(view.queryByLabelText('Minimum price (₦)')).toBeNull();
  fireEvent.press(view.getByLabelText('Apple'));
  expect(props.setDraft).toHaveBeenCalledWith({ ...draft, brands: ['Apple'] });
});
it('filters available brands and retains selected brands', () => {
  const view = render(
    <SearchRefinementFields
      {...props}
      focusGroup="brand"
      brandQuery="app"
      draft={{ ...draft, brands: ['Retained'] }}
    />
  );
  expect(view.getByLabelText('Apple')).toBeTruthy();
  expect(view.queryByLabelText('Samsung')).toBeNull();
  view.rerender(
    <SearchRefinementFields
      {...props}
      focusGroup="brand"
      draft={{ ...draft, brands: ['Retained'] }}
    />
  );
  expect(view.getByLabelText('Retained')).toBeTruthy();
});
it('projects only available conditions and processors into selectable options', () => {
  const view = render(
    <SearchRefinementFields {...props} focusGroup="condition" />
  );
  expect(view.getByLabelText('Used')).toBeTruthy();
  expect(view.queryByLabelText('New')).toBeNull();
  fireEvent.press(view.getByLabelText('Used'));
  expect(props.setDraft).toHaveBeenCalledWith({ ...draft, condition: 'used' });
  fireEvent.press(view.getByLabelText('Processor options'));
  fireEvent.press(view.getByLabelText('M1'));
  expect(props.setDraft).toHaveBeenCalledWith({ ...draft, processor: 'M1' });
});
it('keeps the draft condition selectable after it leaves the facet response', () => {
  const view = render(
    <SearchRefinementFields
      {...props}
      focusGroup="condition"
      conditions={['new']}
      draft={{ ...draft, condition: 'used' }}
    />
  );
  const retained = view.getByLabelText('Used');
  expect(retained).toBeTruthy();
  expect(retained.props.accessibilityState.selected).toBe(true);
});
