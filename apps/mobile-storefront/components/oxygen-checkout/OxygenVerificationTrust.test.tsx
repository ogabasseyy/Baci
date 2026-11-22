import { render, screen } from '@testing-library/react-native';
import { OxygenVerificationTrust } from './OxygenVerificationTrust';

it('uses the same Oxygen logo and reassurance copy as web', () => {
  render(<OxygenVerificationTrust />);
  expect(screen.getByLabelText('Oxygen X Finance Company')).toBeTruthy();
  expect(screen.getByText('Identity verification by Oxygen X')).toBeTruthy();
  expect(
    screen.getByText(
      'A subsidiary of Access Holdings, Access Bank’s parent company.'
    )
  ).toBeTruthy();
});
