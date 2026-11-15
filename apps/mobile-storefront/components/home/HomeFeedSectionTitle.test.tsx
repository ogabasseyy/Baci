import { render, screen } from '@testing-library/react-native';
import { HomeFeedSectionTitle } from './HomeFeedSectionTitle';

describe('HomeFeedSectionTitle', () => {
  it('renders the title as a heading in the theme text colour', () => {
    render(
      <HomeFeedSectionTitle
        colors={{ card: '#1F2937', text: '#F9FAFB' }}
        title="Featured Products"
      />
    );

    const heading = screen.getByRole('header', { name: 'Featured Products' });
    expect(heading).toHaveStyle({ color: '#F9FAFB' });
  });

  it('sits on the card surface with room above it', () => {
    render(
      <HomeFeedSectionTitle
        colors={{ card: '#1F2937', text: '#F9FAFB' }}
        title="Featured Products"
      />
    );

    const surface = screen.getByTestId('home-feed-section-title');
    expect(surface).toHaveStyle({ backgroundColor: '#1F2937' });
    expect(surface).toHaveStyle({ marginTop: 16, paddingTop: 16 });
  });
});
