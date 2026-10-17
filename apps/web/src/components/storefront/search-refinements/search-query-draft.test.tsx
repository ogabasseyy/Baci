import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import {
  SearchQueryDraftSession,
  useSearchQueryDraft,
} from './search-query-draft';

function Consumer() {
  const draft = useSearchQueryDraft();
  if (!draft) return <span>No session</span>;
  return (
    <>
      <span>{draft.query}</span>
      <span>{draft.error}</span>
      <button
        type="button"
        onClick={() => {
          draft.setQuery('samsung');
          draft.setError('Invalid draft');
        }}
      >
        Edit
      </button>
      <button type="button" onClick={draft.reset}>
        Reset
      </button>
    </>
  );
}
it('resets both the typed query and validation feedback to the committed search', () => {
  render(
    <SearchQueryDraftSession initialQuery="iphone">
      <Consumer />
    </SearchQueryDraftSession>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByText('samsung')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByText('iphone')).toBeInTheDocument();
  expect(screen.queryByText('Invalid draft')).toBeNull();
});
