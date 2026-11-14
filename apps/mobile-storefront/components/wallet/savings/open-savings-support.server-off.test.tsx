import { Linking } from 'react-native';
import { showAppAlert } from '@/components/ui/show-app-alert';
import {
  openSavingsSupport,
  savingsSupportMessage,
} from './open-savings-support';

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

  describe('bugfix: support could not tell which plan was stuck', () => {
    it('adds a short plan reference to the message', () => {
      expect(
        savingsSupportMessage('a4300000-0000-4000-8000-000000000010')
      ).toBe(
        'Hi, I need help finishing my savings plan setup. Plan reference: a4300000.'
      );
    });

    it('sends the plan reference in the WhatsApp text', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      await openSavingsSupport('a4300000-0000-4000-8000-000000000010');
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining('Plan%20reference%3A%20a4300000')
      );
    });

    it('keeps the plain message when there is no plan', () => {
      expect(savingsSupportMessage()).toBe(
        'Hi, I need help finishing my savings plan setup.'
      );
    });
  });
});
