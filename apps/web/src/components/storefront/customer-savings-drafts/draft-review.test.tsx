import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';
import { customerSavingsDraftView } from '@/lib/customer-savings-draft-view';
import { DraftReview } from './draft-review';

it('requires revision-specific consent, displays snapshot caveat, and never activates money', () => {
  const draft = customerSavingsDraftView(savingsDraftFixture().record);
  const accept = vi.fn();
  const props = {
    busy: false,
    canReplace: false,
    onAccept: accept,
    onReplace: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<DraftReview {...props} draft={draft} />);
  expect(
    screen.getByRole('button', { name: 'Confirm draft terms' })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm draft terms' }));
  expect(accept).toHaveBeenCalledOnce();
  view.rerender(
    <DraftReview {...props} draft={{ ...draft, revisionId: draft.requestId }} />
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByText(/Saved catalogue price/)).toBeVisible();
  expect(screen.getByText(/not a price guarantee/i)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /fund|pay|contribute/i })
  ).toBeNull();
});
