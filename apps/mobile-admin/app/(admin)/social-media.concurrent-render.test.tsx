import { act, fireEvent, render, screen } from '@testing-library/react';
import { Suspense, startTransition, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socialMediaTestHarness as harness } from '../../__tests__/admin/social-media.test-harness';

describe('SocialMediaScreen concurrent merchant rendering', () => {
  beforeEach(() => harness.reset());
  afterEach(() => harness.cleanup());

  it('keeps merchant A success active when a merchant B render is abandoned', async () => {
    const suspendedMerchantRender = new Promise<never>(() => undefined);
    const merchants = {
      'merchant-a': {
        id: 'merchant-a',
        social_media: { instagram: 'merchant_a' },
      },
      'merchant-b': {
        id: 'merchant-b',
        social_media: { instagram: 'merchant_b' },
      },
    };
    harness.mocks.useMerchant.mockImplementation(() => ({
      isLoading: false,
      merchant: merchants[activeMerchantId],
    }));

    let activeMerchantId: keyof typeof merchants = 'merchant-a';
    function SuspendMerchantB({ merchantId }: { merchantId: string }) {
      if (merchantId === 'merchant-b') throw suspendedMerchantRender;
      return null;
    }

    function Scenario() {
      const [merchantId, setMerchantId] =
        useState<keyof typeof merchants>('merchant-a');
      activeMerchantId = merchantId;
      return (
        <>
          <button
            onClick={() => {
              startTransition(() => setMerchantId('merchant-b'));
            }}
            type="button"
          >
            Switch merchant
          </button>
          <Suspense fallback={<span>Loading merchant B</span>}>
            <harness.Component />
            <SuspendMerchantB merchantId={merchantId} />
          </Suspense>
        </>
      );
    }

    render(<Scenario />);
    const merchantAMutation = harness.mocks.useMutation.mock.calls.at(
      -1
    )?.[0] as
      | {
          onSuccess?: (
            data: unknown,
            variables: unknown,
            context: unknown
          ) => Promise<void>;
        }
      | undefined;
    expect(merchantAMutation?.onSuccess).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Switch merchant' }));
    expect(screen.getByLabelText('Instagram Handle')).toHaveValue('merchant_a');

    await act(async () => {
      await merchantAMutation?.onSuccess?.(
        {},
        { merchantId: 'merchant-a' },
        'merchant-a'
      );
    });

    expect(harness.mocks.alert).toHaveBeenCalledWith(
      'Success',
      'Social media links updated',
      expect.any(Array)
    );
  });
});
