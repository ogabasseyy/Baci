import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { ImeiTicketNotch } from './imei-ticket-notch';

describe('ImeiTicketNotch', () => {
  it('cuts the notch in the page background colour', () => {
    const { toJSON } = render(<ImeiTicketNotch colors={Colors.light} />);
    expect(JSON.stringify(toJSON())).toContain(Colors.light.background);
  });

  it('lets touches through to the card under it', () => {
    const { toJSON } = render(<ImeiTicketNotch colors={Colors.light} />);
    const notch = toJSON();
    if (!notch || Array.isArray(notch)) {
      throw new Error('Expected the notch to render one view');
    }
    // Read from the style itself, so a JSX `pointerEvents` prop would fail.
    expect(StyleSheet.flatten(notch.props.style)).toMatchObject({
      pointerEvents: 'none',
    });
  });
});
