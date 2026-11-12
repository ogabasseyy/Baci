import { Linking } from 'react-native';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { openSavingsSupport } from './open-savings-support';

jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));

describe('openSavingsSupport with PiggyVest off', () => {
  it('opens a prefilled WhatsApp chat with support', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openSavingsSupport();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/wa\.me\/\d+\?text=Hi%2C/)
    );
  });

  describe('bugfix: a failed support link gave no feedback', () => {
    it('shows the support phone number when WhatsApp cannot open', async () => {
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no app'));
      await expect(openSavingsSupport()).resolves.toBeUndefined();
      expect(showAppAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/Call or text us on 0\d+/),
        })
      );
    });
  });
});
