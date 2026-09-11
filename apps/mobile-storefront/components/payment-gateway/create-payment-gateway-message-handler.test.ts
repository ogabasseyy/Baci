import { jest } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';
import { PAYMENT_CLIPBOARD_BRIDGE } from '@/constants/payment-clipboard-bridge';

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

import {
  createHandler,
  sendMessage,
} from './create-payment-gateway-message-handler.test-utils';

describe('createPaymentGatewayMessageHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies clipboard text once and trims the payload', async () => {
    const { copiedGatewayTextRef, copyGatewayText, handler } = createHandler();

    sendMessage(handler, {
      text: '  1234567890  ',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });
    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledTimes(1);
    expect(copyGatewayText).toHaveBeenCalledWith(
      '1234567890',
      'Text copied.',
      undefined
    );
    await waitFor(() => {
      expect(copiedGatewayTextRef.current).toBe('1234567890');
    });
  });

  it('does not dedupe future clipboard messages when copy fails', async () => {
    const { copiedGatewayTextRef, copyGatewayText, handler } = createHandler();
    copyGatewayText
      .mockRejectedValueOnce(new Error('copy failed'))
      .mockResolvedValueOnce(undefined);

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    const firstCopy = copyGatewayText.mock.results[0]?.value;
    await expect(firstCopy).rejects.toThrow('copy failed');
    expect(copiedGatewayTextRef.current).toBeNull();

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.clipboardMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(copiedGatewayTextRef.current).toBe('1234567890');
    });
  });

  it('uses account-number specific copy messages', () => {
    const { copyGatewayText, handler } = createHandler();

    sendMessage(handler, {
      text: '1234567890',
      type: PAYMENT_CLIPBOARD_BRIDGE.accountNumberMessageType,
    });

    expect(copyGatewayText).toHaveBeenCalledWith(
      '1234567890',
      'Account number copied.',
      'Unable to copy account number.'
    );
  });

  it('ignores invalid JSON and non-record messages', () => {
    const { copyGatewayText, handler } = createHandler();

    handler({ nativeEvent: { data: '{' } });
    sendMessage(handler, ['payment_clipboard_copy']);

    expect(copyGatewayText).not.toHaveBeenCalled();
  });
});
