import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadNegotiationEvidenceFile } from './negotiation-evidence';
import { resolveNegotiationCustomer } from './negotiation-modal-customer';
import { insertNegotiationRequest } from './negotiation-modal-request';
import { submitNegotiationUpload } from './negotiation-modal-upload';

vi.mock('./negotiation-modal-customer', () => ({
  resolveNegotiationCustomer: vi.fn(),
}));
vi.mock('./negotiation-modal-request', () => ({
  insertNegotiationRequest: vi.fn(),
}));
vi.mock('./negotiation-evidence', () => ({
  uploadNegotiationEvidenceFile: vi.fn(),
}));

const baseOptions = {
  canApplyAsyncResult: () => true,
  currentPrice: 100_000,
  email: '',
  merchantId: 'merchant-1',
  offer: '90000',
  phone: '',
  productName: 'Phone',
  setMessage: vi.fn(),
  setStatus: vi.fn(),
  supabase: {} as never,
  type: 'single' as const,
  uploadFile: null,
  uploadLink: '',
};

describe('submitNegotiationUpload', () => {
  beforeEach(() => {
    vi.mocked(resolveNegotiationCustomer).mockReset();
    vi.mocked(insertNegotiationRequest).mockReset();
    vi.mocked(uploadNegotiationEvidenceFile).mockReset();
    baseOptions.setMessage.mockClear();
    baseOptions.setStatus.mockClear();
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rejects a submission without a link or file', async () => {
    await submitNegotiationUpload(baseOptions);

    expect(alert).toHaveBeenCalledWith(
      'Upload proof or paste a link before sending your request.'
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('rejects a submission with both a link and a file', async () => {
    await submitNegotiationUpload({
      ...baseOptions,
      uploadFile: new File(['proof'], 'proof.png', { type: 'image/png' }),
      uploadLink: 'https://proof.example/item',
    });

    expect(alert).toHaveBeenCalledWith(
      'Use either a proof upload or a link, not both.'
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('rejects evidence links with unsupported schemes', async () => {
    await submitNegotiationUpload({
      ...baseOptions,
      uploadLink: 'ftp://proof.example/item',
    });

    expect(alert).toHaveBeenCalledWith('Enter a valid http or https URL.');
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('rejects comma-formatted and trailing-character offer values', async () => {
    for (const offer of ['90,000', '90000abc']) {
      await submitNegotiationUpload({
        ...baseOptions,
        offer,
        uploadLink: 'https://proof.example/item',
      });
    }

    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenNthCalledWith(
      1,
      'Enter a valid offer amount before sending your request.'
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('fails closed when customer verification rejects', async () => {
    vi.mocked(resolveNegotiationCustomer).mockRejectedValue(
      new Error('auth unavailable')
    );

    await submitNegotiationUpload({
      ...baseOptions,
      uploadLink: 'https://proof.example/item',
    });

    expect(alert).toHaveBeenCalledWith(
      'Unable to verify your account. Please try again.'
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('requires contact when the verified customer has none', async () => {
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: null,
      customerId: 'customer-1',
      customerPhone: null,
    });

    await submitNegotiationUpload({
      ...baseOptions,
      uploadLink: 'https://proof.example/item',
    });

    expect(alert).toHaveBeenCalledWith(
      "Provide an email address or Phone / WhatsApp number so we can send the merchant's decision."
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('persists the verified account contact with a valid link', async () => {
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: '15551234567',
    });
    vi.mocked(insertNegotiationRequest).mockResolvedValue(undefined);

    await submitNegotiationUpload({
      ...baseOptions,
      uploadLink: 'https://proof.example/item',
    });

    expect(insertNegotiationRequest).toHaveBeenCalledWith(
      baseOptions.supabase,
      expect.objectContaining({
        customerId: 'customer-1',
        customerEmail: 'buyer@example.com',
        customerPhone: '15551234567',
        evidenceUrl: 'https://proof.example/item',
        offeredPrice: 90_000,
      })
    );
    expect(baseOptions.setStatus).toHaveBeenLastCalledWith('submitted');
  });

  it('uploads a file before inserting the request', async () => {
    const file = new File(['proof'], 'proof.png', { type: 'image/png' });
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: null,
    });
    vi.mocked(uploadNegotiationEvidenceFile).mockResolvedValue(
      'merchant-1/evidence.png'
    );
    vi.mocked(insertNegotiationRequest).mockResolvedValue(undefined);

    await submitNegotiationUpload({ ...baseOptions, uploadFile: file });

    expect(uploadNegotiationEvidenceFile).toHaveBeenCalledWith({
      file,
      merchantId: 'merchant-1',
    });
    expect(insertNegotiationRequest).toHaveBeenCalledWith(
      baseOptions.supabase,
      expect.objectContaining({ evidenceUrl: 'merchant-1/evidence.png' })
    );
  });

  it('returns to upload after a file upload rejection', async () => {
    const error = new Error('Evidence upload denied');
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: null,
    });
    vi.mocked(uploadNegotiationEvidenceFile).mockRejectedValue(error);

    await submitNegotiationUpload({
      ...baseOptions,
      uploadFile: new File(['proof'], 'proof.png', { type: 'image/png' }),
    });

    expect(alert).toHaveBeenCalledWith('Evidence upload denied');
    expect(baseOptions.setStatus).toHaveBeenLastCalledWith('upload');
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });

  it('reuses an uploaded evidence object when insertion fails and is retried', async () => {
    const file = new File(['proof'], 'proof.png', { type: 'image/png' });
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: null,
    });
    vi.mocked(uploadNegotiationEvidenceFile).mockResolvedValue(
      'merchant-1/evidence.png'
    );
    vi.mocked(insertNegotiationRequest)
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce(undefined);

    await submitNegotiationUpload({ ...baseOptions, uploadFile: file });
    await submitNegotiationUpload({ ...baseOptions, uploadFile: file });

    expect(uploadNegotiationEvidenceFile).toHaveBeenCalledTimes(1);
    expect(insertNegotiationRequest).toHaveBeenCalledTimes(2);
    expect(insertNegotiationRequest).toHaveBeenNthCalledWith(
      2,
      baseOptions.supabase,
      expect.objectContaining({ evidenceUrl: 'merchant-1/evidence.png' })
    );
    expect(baseOptions.setStatus).toHaveBeenLastCalledWith('submitted');
  });

  it('rejects a request without merchant context', async () => {
    vi.mocked(resolveNegotiationCustomer).mockResolvedValue({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: null,
    });

    await submitNegotiationUpload({
      ...baseOptions,
      merchantId: '',
      uploadLink: 'https://proof.example/item',
    });

    expect(alert).toHaveBeenCalledWith(
      'Unable to submit request — merchant context unavailable.'
    );
    expect(insertNegotiationRequest).not.toHaveBeenCalled();
  });
});
