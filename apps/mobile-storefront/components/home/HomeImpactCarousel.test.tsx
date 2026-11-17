import { fireEvent, render, screen } from '@testing-library/react-native';
import { HomeImpactCarousel } from './HomeImpactCarousel';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

it('opens Repair Lab from the sustainability story', () => {
  render(<HomeImpactCarousel />);
  fireEvent.press(screen.getByText(/Explore repairs/));
  expect(mockPush).toHaveBeenCalledWith('/repairs');
});
