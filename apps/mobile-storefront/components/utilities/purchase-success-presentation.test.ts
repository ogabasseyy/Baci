import {
  getPurchaseMessage,
  getPurchasePresentation,
  getReceiptStatus,
  isTokenGeneratingType,
} from './purchase-success-presentation';

describe('getPurchaseMessage', () => {
  it('announces token generation for power/tv/gaming processing rows', () => {
    expect(
      getPurchaseMessage({
        identifier: '43901766923',
        refundConfirmed: null,
        refundSkipped: null,
        status: 'processing',
        type: 'power',
      })
    ).toBe(
      'Your electricity payment for 43901766923 was received. We are generating your token now.'
    );
    expect(
      getPurchaseMessage({
        identifier: '',
        refundConfirmed: null,
        refundSkipped: null,
        status: 'processing',
        type: 'airtime',
      })
    ).toBe(
      'Your airtime payment was received. We are completing your purchase now.'
    );
  });

  it('claims a refund only with proof, else stays soft', () => {
    const base = {
      identifier: '43901766923',
      status: 'failed' as const,
      type: 'power',
    };
    expect(
      getPurchaseMessage({
        ...base,
        refundConfirmed: true,
        refundSkipped: null,
      })
    ).toContain('has been refunded');
    expect(
      getPurchaseMessage({
        ...base,
        refundConfirmed: false,
        refundSkipped: null,
      })
    ).toContain('check your wallet balance');
    expect(
      getPurchaseMessage({
        ...base,
        refundConfirmed: null,
        refundSkipped: null,
      })
    ).not.toContain('refunded');
  });

  it('says no charge was made for skipped refunds', () => {
    expect(
      getPurchaseMessage({
        identifier: '43901766923',
        refundConfirmed: false,
        refundSkipped: true,
        status: 'failed',
        type: 'power',
      })
    ).toBe(
      'Your electricity purchase for 43901766923 failed. No charge was made to your wallet — please try again.'
    );
    expect(
      getPurchaseMessage({
        identifier: '',
        refundConfirmed: false,
        refundSkipped: true,
        status: 'failed',
        type: 'airtime',
      })
    ).toBe(
      'Your airtime purchase failed. No charge was made to your wallet — please try again.'
    );
  });

  it('renders terminal non-failure statuses', () => {
    expect(
      getPurchaseMessage({
        identifier: 'X',
        refundConfirmed: null,
        refundSkipped: null,
        status: 'successful',
        type: 'data',
      })
    ).toContain('was successful');
    expect(
      getPurchaseMessage({
        identifier: '',
        refundConfirmed: null,
        refundSkipped: null,
        status: 'cancelled',
        type: 'tv',
      })
    ).toContain('was cancelled');
    expect(
      getPurchaseMessage({
        identifier: '',
        refundConfirmed: null,
        refundSkipped: null,
        status: 'error',
        type: 'gaming',
      })
    ).toContain('could not complete');
  });
});

describe('getPurchasePresentation', () => {
  it('maps each status to title, icon, and shareability', () => {
    expect(getPurchasePresentation('processing')).toEqual({
      canShareReceipt: true,
      iconName: 'time-outline',
      isProcessing: true,
      title: 'Payment Received',
    });
    expect(getPurchasePresentation('successful')).toMatchObject({
      canShareReceipt: true,
      iconName: 'checkmark-circle',
      title: 'Purchase Successful!',
    });
    expect(getPurchasePresentation('failed')).toMatchObject({
      canShareReceipt: false,
      title: 'Purchase Failed',
    });
    expect(getPurchasePresentation('cancelled').iconName).toBe('close-circle');
  });
});

describe('getReceiptStatus', () => {
  it('shows receipts only for processing and successful rows', () => {
    expect(getReceiptStatus('processing')).toBe('processing');
    expect(getReceiptStatus('successful')).toBe('successful');
    expect(getReceiptStatus('failed')).toBeNull();
    expect(getReceiptStatus('error')).toBeNull();
    expect(getReceiptStatus('cancelled')).toBeNull();
  });
});

describe('isTokenGeneratingType', () => {
  it('flags power, tv, and gaming only', () => {
    expect(isTokenGeneratingType('power')).toBe(true);
    expect(isTokenGeneratingType('tv')).toBe(true);
    expect(isTokenGeneratingType('gaming')).toBe(true);
    expect(isTokenGeneratingType('airtime')).toBe(false);
    expect(isTokenGeneratingType('data')).toBe(false);
  });
});
