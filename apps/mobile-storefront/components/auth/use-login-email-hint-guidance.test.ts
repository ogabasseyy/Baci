import { renderHook, waitFor } from '@testing-library/react-native';
import { useLoginEmailHintGuidance } from './use-login-email-hint-guidance';

function setup(
  overrides: Partial<Parameters<typeof useLoginEmailHintGuidance>[0]> = {}
) {
  return renderHook(
    (props: Parameters<typeof useLoginEmailHintGuidance>[0]) =>
      useLoginEmailHintGuidance(props),
    {
      initialProps: {
        currentEmail: '',
        emailParam: undefined,
        initialEmail: '',
        onError: () => undefined,
        returnTo: undefined,
        ...overrides,
      },
    }
  );
}

describe('useLoginEmailHintGuidance', () => {
  it('initializes masked guidance from the email param', () => {
    const { result } = setup({ emailParam: 'b***@yahoo.co.uk' });

    expect(result.current).toBe('b***@yahoo.co.uk');
  });

  it('starts empty without a param and fills from the claim returnTo', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ emailHint: 'b***@yahoo.co.uk' }),
      ok: true,
    });
    const { result } = setup({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      returnTo: '/receipts/claim/claim-token_123',
    });

    expect(result.current).toBe('');

    await waitFor(() => expect(result.current).toBe('b***@yahoo.co.uk'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when an email already exists', () => {
    const fetchImpl = jest.fn();
    const { result } = setup({
      currentEmail: 'typed@example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      returnTo: '/receipts/claim/claim-token_123',
    });

    expect(result.current).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ignores late fetch results after unmount', async () => {
    let resolveFetch!: (value: {
      json: () => Promise<unknown>;
      ok: boolean;
    }) => void;
    const fetchImpl = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    const onError = jest.fn();
    const { result, unmount } = setup({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onError,
      returnTo: '/receipts/claim/claim-token_123',
    });

    unmount();
    resolveFetch({
      json: () => Promise.resolve({ emailHint: 'b***@yahoo.co.uk' }),
      ok: true,
    });
    await Promise.resolve();

    expect(result.current).toBe('');
    expect(onError).not.toHaveBeenCalled();
  });
});
