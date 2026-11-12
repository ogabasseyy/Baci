import { Linking } from 'react-native';
import { openSavingsSupport } from './open-savings-support';

describe('openSavingsSupport with PiggyVest off', () => {
  it('opens a prefilled WhatsApp chat with support', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openSavingsSupport();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/wa\.me\/\d+\?text=Hi%2C/)
    );
  });

  it('never throws when WhatsApp cannot open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no app'));
    await expect(openSavingsSupport()).resolves.toBeUndefined();
  });
});
