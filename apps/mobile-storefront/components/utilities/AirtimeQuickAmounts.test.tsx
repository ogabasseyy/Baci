import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { AirtimeQuickAmounts } from './AirtimeQuickAmounts';

describe('AirtimeQuickAmounts', () => {
  it('selects the tapped amount', () => {
    const onSelect = jest.fn();
    render(
      <AirtimeQuickAmounts
        amounts={[100, 200]}
        colors={Colors.light}
        onSelect={onSelect}
        selectedAmount={0}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: '₦200' }));
    expect(onSelect).toHaveBeenCalledWith(200);
  });

  it('marks only the chosen amount as selected', () => {
    render(
      <AirtimeQuickAmounts
        amounts={[100, 200]}
        colors={Colors.light}
        onSelect={jest.fn()}
        selectedAmount={100}
      />
    );

    expect(screen.getByRole('button', { name: '₦100' })).toBeSelected();
    expect(screen.getByRole('button', { name: '₦200' })).not.toBeSelected();
  });
});
