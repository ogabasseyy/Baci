import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { piggyvestSavingsScreenSchema } from '@/schemas/piggyvest-savings-screen';
import { purchaseFixture } from '../../../../../../packages/shared/src/test-fixtures/piggyvest-purchase';
import { PurchaseScreenJourney } from './purchase-screen-journey';

it('keeps funding unavailable without matching server eligibility', () => {
  const source = piggyvestSavingsScreenSchema.parse(purchaseFixture().source);
  if (source.status !== 'ready') throw new Error('fixture');
  render(
    <PurchaseScreenJourney
      source={source}
      fundingBlocked={true}
      submitPolicy={undefined}
    />
  );
  expect(screen.getByText('Server eligibility is unavailable.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /fund/i })).toBeNull();
});
