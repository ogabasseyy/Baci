import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { HeroVariantStyles } from './HeroSlideShared';
import { StandardSlide } from './StandardSlide';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const props = {
  item: {
    ctaLink: '/deals/standard',
    ctaText: 'Shop now',
    image: 'https://example.com/standard.jpg',
    subtitle: 'Everyday essentials',
    title: 'New collection',
  },
  screenWidth: 390,
  styles: {} as unknown as HeroVariantStyles,
};

describe('StandardSlide', () => {
  it('renders the title and CTA', () => {
    // Arrange & Act
    render(<StandardSlide {...props} />);

    // Assert
    expect(screen.getByText('New collection')).toBeTruthy();
    expect(screen.getByText('Shop now')).toBeTruthy();
  });

  it('navigates to the CTA link on press', () => {
    // Arrange
    render(<StandardSlide {...props} />);

    // Act
    fireEvent.press(screen.getByLabelText('Shop now'));

    // Assert
    expect(mockPush).toHaveBeenCalledWith('/deals/standard');
  });
});
