import { render, screen } from '@testing-library/react-native';
import { HomeImpactCarousel } from './HomeImpactCarousel';

it('shows the four story quotes in swipe order as accessible text', () => {
  render(<HomeImpactCarousel />);

  expect(
    screen.getAllByText(/^“/).map((quote) => quote.props.children)
  ).toEqual([
    '“I got my first paycheck from my smartphone.”',
    '“Omoh, if not for this laptop, how I wan take chop?”',
    '“I thought I needed a new phone. I just needed a new battery.”',
    '“Small small, I saved for the phone I wanted.”',
  ]);
});
