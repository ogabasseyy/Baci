import { render, screen } from '@testing-library/react-native';
import { SavingsSetupHero } from './SavingsSetupHero';

describe('SavingsSetupHero (server off)', () => {
  it('renders the savings setup headline without any server dependency', () => {
    render(<SavingsSetupHero />);
    expect(screen.getByRole('header')).toHaveTextContent(
      'Dream it.\nSave for it.'
    );
    expect(
      screen.getByText('Your next device, one little win at a time.')
    ).toBeOnTheScreen();
  });
});
