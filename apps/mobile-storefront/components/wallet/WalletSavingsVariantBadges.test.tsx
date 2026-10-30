import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsVariantBadges } from './WalletSavingsVariantBadges';

it('shows an accessible colour swatch and storage value without field labels', () => {
  render(
    <WalletSavingsVariantBadges
      label="Color: Black · Storage: 256GB"
      colors={Colors.dark}
    />
  );
  expect(screen.getByLabelText('Black')).toBeTruthy();
  expect(screen.getByText('256GB')).toBeTruthy();
  expect(screen.queryByText(/Color:|Storage:/)).toBeNull();
});
it('keeps unknown colour names readable rather than inventing a colour', () => {
  render(
    <WalletSavingsVariantBadges
      label="Colour: Mystery · Storage: 1TB"
      colors={Colors.light}
    />
  );
  expect(screen.getByText('Mystery')).toBeTruthy();
  expect(screen.getByText('1TB')).toBeTruthy();
});
it('reserves the same metadata row when a plan has no variant', () => {
  render(<WalletSavingsVariantBadges colors={Colors.dark} />);
  expect(screen.queryByText('256GB')).toBeNull();
});
