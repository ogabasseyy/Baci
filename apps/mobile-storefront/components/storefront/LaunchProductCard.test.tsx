import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Product } from '@/types/product';
import { LaunchProductCard } from './LaunchProductCard';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const item = {
  image: 'https://example.com/phone.jpg',
  name: 'Samsung Galaxy A27 5G',
  price: 450000,
  slug: 'samsung-galaxy-a27-5g',
} as Product;

const props = {
  cardWidth: 168,
  colors: {
    background: '#ffffff',
    border: '#e5e5e5',
    card: '#ffffff',
    primary: '#e60023',
    primaryForeground: '#ffffff',
    text: '#111111',
  },
  item,
  sectionTitle: 'Just launched',
};

describe('LaunchProductCard', () => {
  it('renders the product name and section title', () => {
    // Arrange & Act
    render(<LaunchProductCard {...props} />);

    // Assert
    expect(screen.getByText('Samsung Galaxy A27 5G')).toBeTruthy();
    expect(screen.getByText('Just launched')).toBeTruthy();
  });

  it('navigates to the product on press', () => {
    // Arrange
    render(<LaunchProductCard {...props} />);

    // Act
    fireEvent.press(
      screen.getByRole('button', { name: /Samsung Galaxy A27 5G/ })
    );

    // Assert
    expect(mockPush).toHaveBeenCalledWith('/product/samsung-galaxy-a27-5g');
  });
});
