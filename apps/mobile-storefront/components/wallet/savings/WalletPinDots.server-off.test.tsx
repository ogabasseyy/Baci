import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletPinDots } from './WalletPinDots';

// Pure UI: no server call, so it is the same whether PiggyVest is on or off.
describe('WalletPinDots', () => {
  it('announces only how many digits are entered, never the digits', () => {
    render(<WalletPinDots colors={Colors.light} label="PIN" length={3} />);
    expect(
      screen.getByLabelText('PIN, 3 of 6 digits entered')
    ).toBeOnTheScreen();
  });

  it('shows a fixed number of boxes for a code of known length', () => {
    render(
      <WalletPinDots
        colors={Colors.light}
        label="Code"
        length={2}
        fixedSlots={6}
      />
    );
    expect(
      screen.getByLabelText('Code, 2 of 6 digits entered')
    ).toBeOnTheScreen();
  });

  it('lets the boxes shrink to fit a narrow sheet instead of overflowing', () => {
    render(
      <WalletPinDots
        colors={Colors.light}
        label="Code"
        length={0}
        fixedSlots={6}
      />
    );
    const row = screen.getByLabelText('Code, 0 of 6 digits entered');
    const first = row.children[0];
    if (typeof first === 'string') throw new Error('expected a box');
    const box = StyleSheet.flatten(first.props.style);
    expect(box).toMatchObject({ flexShrink: 1, maxWidth: 44 });
    expect(box.width).toBeUndefined();
  });

  it('shows four boxes up to four digits, with no empty extra box', () => {
    for (const digits of [0, 4]) {
      const view = render(
        <WalletPinDots colors={Colors.light} label="PIN" length={digits} />
      );
      expect(
        screen.getByLabelText(`PIN, ${digits} of 6 digits entered`).children
      ).toHaveLength(4);
      view.unmount();
    }
  });

  it('grows only as a fifth or sixth digit is typed', () => {
    for (const digits of [5, 6]) {
      const view = render(
        <WalletPinDots colors={Colors.light} label="PIN" length={digits} />
      );
      expect(
        screen.getByLabelText(`PIN, ${digits} of 6 digits entered`).children
      ).toHaveLength(digits);
      view.unmount();
    }
  });
});
