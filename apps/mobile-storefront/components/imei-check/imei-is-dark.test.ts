import { describe, expect, it } from '@jest/globals';
import Colors from '@/constants/Colors';
import { isImeiDark } from './imei-is-dark';

describe('isImeiDark', () => {
  it('tells light from dark by the page background', () => {
    expect(isImeiDark(Colors.light)).toBe(false);
    expect(isImeiDark(Colors.dark)).toBe(true);
  });
  it('reads an off-white light theme as light, not dark (Muse)', () => {
    expect(isImeiDark({ ...Colors.light, background: '#fafaf7' })).toBe(false);
    expect(isImeiDark({ ...Colors.light, background: '#121212' })).toBe(true);
  });
  it('reads short, translucent and rgb() backgrounds by brightness (Muse)', () => {
    const on = (background: string) =>
      isImeiDark({ ...Colors.light, background });
    expect(on('#fff')).toBe(false);
    expect(on('#111')).toBe(true);
    expect(on('#ffffff00')).toBe(false);
    expect(on('rgb(18, 18, 18)')).toBe(true);
    expect(on('rgba(250, 250, 247, 1)')).toBe(false);
  });
  it('treats a background it cannot read as light (Muse)', () => {
    expect(isImeiDark({ ...Colors.light, background: 'transparent' })).toBe(
      false
    );
    expect(isImeiDark({ ...Colors.light, background: 'hsl(0, 0%, 98%)' })).toBe(
      false
    );
  });
});
