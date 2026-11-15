import { imeiFindHint } from './imei-find-hint';

describe('imeiFindHint', () => {
  it('tells where each identifier is found', () => {
    expect(imeiFindHint('serial')).toBe(
      'Find it in Settings › General › About'
    );
    expect(imeiFindHint('both')).toBe(
      'Dial *#06# or Settings › General › About'
    );
    expect(imeiFindHint('imei')).toBe('Dial *#06# to find your IMEI');
  });
});
