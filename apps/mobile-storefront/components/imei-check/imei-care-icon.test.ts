import { describe, expect, it } from '@jest/globals';
import Colors from '@/constants/Colors';
import { imeiCareIcon } from './imei-care-icon';

describe('imeiCareIcon', () => {
  it('uses a soft pink circle in light mode and a deep one in dark mode', () => {
    expect(imeiCareIcon(Colors.light)).toEqual({
      background: '#fce8ed',
      color: '#a7182c',
    });
    expect(imeiCareIcon(Colors.dark).color).toBe('#ffffff');
  });
});
