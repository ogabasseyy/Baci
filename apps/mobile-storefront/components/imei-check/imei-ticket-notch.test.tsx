import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiTicketNotch } from './imei-ticket-notch';

describe('ImeiTicketNotch', () => {
  it('cuts the notch in the page background colour', () => {
    const { toJSON } = render(<ImeiTicketNotch colors={Colors.light} />);
    expect(JSON.stringify(toJSON())).toContain(Colors.light.background);
  });
});
