import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsProductSuggestions } from './StartSavingsProductSuggestions';
import { createStartSavingsController } from './start-savings-controller.test-support';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('StartSavingsProductSuggestions with PiggyVest off', () => {
  it('says when nothing matches', () => {
    render(
      <StartSavingsProductSuggestions
        colors={Colors.light}
        controller={createStartSavingsController({
          debouncedSearch: 'zzz',
          searchValue: 'zzz',
          products: [],
        })}
      />
    );
    expect(screen.queryByText('FIND YOUR NEXT UPGRADE')).toBeNull();
  });
});
