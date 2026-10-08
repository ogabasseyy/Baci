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
it('merges a case-variant draft processor into the facet spelling', () => {
  const view = render(
    <SearchRefinementFields
      {...props}
      processors={['Intel Core i7', 'M1']}
      draft={{ ...draft, processor: 'intel core i7' }}
    />
  );
  fireEvent.press(view.getByLabelText('Processor options'));
  // One radio in the facet spelling, selected via the draft value.
  const radios = view.getAllByLabelText('Intel Core i7');
  expect(radios).toHaveLength(1);
  expect(radios[0].props.accessibilityState.selected).toBe(true);
});
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
it('merges case-variant draft brands into the facet spelling', () => {
  const setDraft = jest.fn();
  const view = render(
    <SearchRefinementFields
      {...props}
      focusGroup="brand"
      setDraft={setDraft}
      draft={{ ...draft, brands: ['apple'] }}
    />
  );
  // One choice in the facet spelling, selected via the draft value.
  expect(view.queryAllByLabelText(/apple/i)).toHaveLength(1);
  fireEvent.press(view.getByLabelText('Apple'));
  // Deselecting clears the equivalent lowercase constraint entirely.
  expect(setDraft).toHaveBeenCalledWith({ ...draft, brands: [] });
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
it('surfaces a deactivated draft category instead of selecting all categories', () => {
  const view = render(
    <SearchRefinementFields
      {...props}
      focusGroup="category"
      categories={[{ id: 'c1', name: 'Phones' }]}
      draft={{ ...draft, categoryId: 'c2' }}
    />
  );
  const retained = view.getByLabelText('Unavailable category');
  expect(retained).toBeTruthy();
  expect(retained.props.accessibilityState.selected).toBe(true);
});
