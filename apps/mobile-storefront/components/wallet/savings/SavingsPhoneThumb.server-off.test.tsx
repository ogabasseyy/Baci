import { render, screen } from '@testing-library/react-native';
import { SavingsPhoneThumb } from './SavingsPhoneThumb';

it('falls back to a phone icon without a picture', () => {
  render(
    <SavingsPhoneThumb
      background="#fff"
      iconColor="#000"
      image={null}
      title="Phone"
    />
  );
  expect(screen.queryByLabelText('Phone')).toBeNull();
});
