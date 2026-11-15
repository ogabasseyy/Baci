import { requestQuizV2 } from '@/services/quiz-request';
import {
  getQuizAttestationHeaders,
  QUIZ_APP_CHECK_HEADER,
  QUIZ_ATTESTATION_NONCE_HEADER,
} from './quiz-app-attestation';

jest.mock('@/services/quiz-request', () => ({ requestQuizV2: jest.fn() }));

const mockRequest = requestQuizV2 as jest.Mock;

describe('getQuizAttestationHeaders', () => {
  beforeEach(() => mockRequest.mockReset());

  it('fetches a challenge then a fresh token and returns both headers', async () => {
    mockRequest.mockResolvedValue({ expiresAt: 'x', nonce: 'n1' });
    const provider = jest.fn().mockResolvedValue('tok');
    const headers = await getQuizAttestationHeaders('e1', {}, provider);
    expect(headers).toEqual({
      [QUIZ_APP_CHECK_HEADER]: 'tok',
      [QUIZ_ATTESTATION_NONCE_HEADER]: 'n1',
    });
    expect(mockRequest.mock.invocationCallOrder[0]).toBeLessThan(
      provider.mock.invocationCallOrder[0]
    );
  });
  it('returns null when the device cannot mint a token', async () => {
    mockRequest.mockResolvedValue({ expiresAt: 'x', nonce: 'n1' });
    expect(
      await getQuizAttestationHeaders('e1', {}, async () => null)
    ).toBeNull();
  });
  it('returns null instead of throwing when the challenge fails', async () => {
    mockRequest.mockRejectedValue(new Error('offline'));
    const provider = jest.fn();
    expect(await getQuizAttestationHeaders('e1', {}, provider)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
});
