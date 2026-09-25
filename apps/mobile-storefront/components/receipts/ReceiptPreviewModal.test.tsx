import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { ReceiptPreviewModal } from './ReceiptPreviewModal';

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
    useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
  };
});

describe('ReceiptPreviewModal', () => {
  it('titles an explicit proforma document as a proforma preview', () => {
    render(
      <ReceiptPreviewModal
        visible
        html="<html>proforma</html>"
        isPaid={false}
        documentType="proforma"
        onClose={() => undefined}
      />
    );

    expect(screen.getByText('Proforma Invoice Preview')).toBeTruthy();
  });

  it('keeps the commercial invoice title without an explicit kind', () => {
    render(
      <ReceiptPreviewModal
        visible
        html="<html>invoice</html>"
        isPaid={false}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText('Invoice Preview')).toBeTruthy();
  });

  it('keeps the receipt title for paid orders', () => {
    render(
      <ReceiptPreviewModal
        visible
        html="<html>receipt</html>"
        isPaid
        onClose={() => undefined}
      />
    );

    expect(screen.getByText('Receipt Preview')).toBeTruthy();
  });
});
