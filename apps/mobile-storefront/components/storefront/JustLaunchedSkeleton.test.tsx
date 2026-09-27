import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { JustLaunchedSkeleton } from './JustLaunchedSkeleton';

jest.mock('@/components/ui/Skeleton', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Skeleton: () => <View testID="launch-skeleton-block" />,
  };
});

describe('JustLaunchedSkeleton', () => {
  it('renders the section heading with two skeleton cards', () => {
    // Arrange & Act
    render(
      <JustLaunchedSkeleton
        cardWidth={328}
        colors={{
          background: '#ffffff',
          border: '#cccccc',
          card: '#ffffff',
          text: '#000000',
        }}
        title="Just Launched"
      />
    );

    // Assert
    expect(screen.getByText('Just Launched')).toBeTruthy();
    expect(
      screen.getAllByTestId('launch-skeleton-block').length
    ).toBeGreaterThan(0);
  });
});
