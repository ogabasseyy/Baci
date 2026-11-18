import { fireEvent, render, screen } from '@testing-library/react-native';
import { HomeCategoryDiscovery } from './HomeCategoryDiscovery';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-categories', () => ({
  useCategories: () => ({ data: [{ slug: 'smartphones' }] }),
}));

it('opens matched categories and uses search when a category is missing', () => {
  render(<HomeCategoryDiscovery />);
  fireEvent.press(screen.getByLabelText('Browse phones'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/category/[slug]',
    params: { slug: 'smartphones' },
  });
  fireEvent.press(screen.getByLabelText('Browse laptops'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/search',
    params: { q: 'laptops' },
  });
});
