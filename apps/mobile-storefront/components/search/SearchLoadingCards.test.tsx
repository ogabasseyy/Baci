import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import SearchLoadingCards from './SearchLoadingCards';

it('reserves a two-column grid while data loads without invented product facts', () => {
  render(<SearchLoadingCards colors={Colors.light} />);
  expect(screen.getAllByTestId('search-loading-card')).toHaveLength(4);
  expect(screen.getByText('Searching…')).toBeTruthy();
});
