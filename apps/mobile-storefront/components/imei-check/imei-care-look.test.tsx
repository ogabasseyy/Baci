import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  IMEI_CARE,
  ImeiTicketNotch,
  imeiCareIcon,
  isImeiDark,
} from './imei-care-look';

describe('imei care look', () => {
  it('tells light from dark by the page background', () => {
    expect(isImeiDark(Colors.light)).toBe(false);
    expect(isImeiDark(Colors.dark)).toBe(true);
  });

  it('reads an off-white light theme as light, not dark (Muse)', () => {
    expect(isImeiDark({ ...Colors.light, background: '#fafaf7' })).toBe(false);
    expect(isImeiDark({ ...Colors.light, background: '#121212' })).toBe(true);
  });

  it('uses a soft pink circle in light mode and a deep one in dark mode', () => {
    expect(imeiCareIcon(Colors.light)).toEqual({
      background: '#fce8ed',
      color: '#a7182c',
    });
    expect(imeiCareIcon(Colors.dark).color).toBe('#ffffff');
  });

  it('keeps the hero burgundy with white text', () => {
    expect(IMEI_CARE.hero).toBe('#351521');
    expect(IMEI_CARE.heroText).toBe('#ffffff');
  });

  it('cuts the notch in the page background colour', () => {
    const { toJSON } = render(<ImeiTicketNotch colors={Colors.light} />);
    expect(JSON.stringify(toJSON())).toContain(Colors.light.background);
  });
});
