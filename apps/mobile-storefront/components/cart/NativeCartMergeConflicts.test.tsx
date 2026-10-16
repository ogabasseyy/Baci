import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { NativeCartMergeConflicts } from './NativeCartMergeConflicts';

const item = { productId: '11111111-1111-4111-8111-111111111111' };

describe('NativeCartMergeConflicts', () => {
  it('renders sibling lanes that share one product identity as separate rows', () => {
    const onPick = jest.fn();
    const view = render(
      <NativeCartMergeConflicts
        colors={Colors.light}
        conflicts={[
          {
            item,
            existing: { quantity: 1 },
            incoming: {
              quantity: 1,
              voucherToken: 'tok-a',
              voucherAwardId: 'award-a',
            },
          },
          {
            item,
            existing: { quantity: 2, negotiatedUnitPriceMinor: 9000 },
            incoming: { quantity: 3, negotiatedUnitPriceMinor: 8000 },
          },
        ]}
        disabled={false}
        onPick={onPick}
      />
    );
    // Both lanes render their own choice buttons despite sharing the
    // base item identity.
    expect(view.getAllByText('Keep saved offer')).toHaveLength(2);
    expect(view.getAllByText('Keep this cart offer')).toHaveLength(2);
    fireEvent.press(view.getAllByText('Keep saved offer')[1]!);
    expect(onPick).toHaveBeenCalledWith({ item, keep: 'incoming' });
  });
});
