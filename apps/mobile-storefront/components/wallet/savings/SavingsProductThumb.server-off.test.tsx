import { render, screen } from '@testing-library/react-native';
import { SavingsProductThumb } from './SavingsProductThumb';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('SavingsProductThumb with PiggyVest off', () => {
  it('shows a phone icon instead of a placeholder when there is no picture', () => {
    render(<SavingsProductThumb uri="" title="Sandbox Test Phone" />);
    expect(
      screen.getByLabelText('Sandbox Test Phone, no picture')
    ).toBeOnTheScreen();
  });

  it('treats a generated "No Image" picture as no picture', () => {
    render(
      <SavingsProductThumb
        uri="https://placehold.co/400x400?text=No+Image"
        title="Phone"
      />
    );
    expect(screen.getByLabelText('Phone, no picture')).toBeOnTheScreen();
  });

  it('shows the real picture when there is one', () => {
    render(
      <SavingsProductThumb
        uri="https://cdn.example.com/phone.jpg"
        title="Phone"
      />
    );
    expect(screen.queryByLabelText('Phone, no picture')).toBeNull();
  });
});
