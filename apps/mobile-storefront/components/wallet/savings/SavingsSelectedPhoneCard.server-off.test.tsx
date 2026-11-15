import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsSelectedPhoneCard } from './SavingsSelectedPhoneCard';

jest.mock('expo-image', () => ({ Image: () => null }));

const product = {
  id: 'phone',
  name: 'Sandbox Test Phone',
  image: '',
  slug: 'phone',
  price: 250000,
  variantId: null,
  requiresVariantSelection: false,
  conditionLabel: 'New',
};

describe('SavingsSelectedPhoneCard with PiggyVest off', () => {
  it('shows name, condition tag, price and a Change pill', () => {
    const onChange = jest.fn();
    render(
      <SavingsSelectedPhoneCard
        colors={Colors.light}
        product={product}
        imageUri=""
        loadingOptions={false}
        onChange={onChange}
      />
    );
    expect(screen.getByText('Sandbox Test Phone')).toBeOnTheScreen();
    expect(screen.getByText('New')).toBeOnTheScreen();
    expect(screen.getByText('₦250,000')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Change savings device' })
    );
    expect(onChange).toHaveBeenCalled();
  });

  it('asks for options instead of a price until a variant is chosen', () => {
    render(
      <SavingsSelectedPhoneCard
        colors={Colors.light}
        product={{ ...product, requiresVariantSelection: true }}
        imageUri=""
        loadingOptions={false}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText('Choose your options')).toBeOnTheScreen();
    expect(screen.queryByText('₦250,000')).toBeNull();
  });
});
