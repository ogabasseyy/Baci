import { describe, expect, it } from 'vitest';
import { gamingSelectionPreviewErrors } from './gaming-selection-preview-errors';

describe('Gaming selection preview errors', () => {
  it.each([
    410, 422,
  ])('classifies status %s as a rejected cached selection', (status) => {
    const error = gamingSelectionPreviewErrors.makeRequestError(
      status,
      'rejected'
    );

    expect(gamingSelectionPreviewErrors.isRejected(error)).toBe(true);
  });

  it('does not classify unrelated failures as a rejected cached selection', () => {
    expect(
      gamingSelectionPreviewErrors.isRejected(
        gamingSelectionPreviewErrors.makeRequestError(404, 'ambiguous')
      )
    ).toBe(false);
    expect(gamingSelectionPreviewErrors.isRejected(new Error('network'))).toBe(
      false
    );
  });

  it('preserves Error messages and uses fallback text for unknown causes', () => {
    expect(
      gamingSelectionPreviewErrors.errorMessage(new Error('specific'), 'safe')
    ).toBe('specific');
    expect(gamingSelectionPreviewErrors.errorMessage(null, 'safe')).toBe(
      'safe'
    );
    expect(
      gamingSelectionPreviewErrors.makeInvalidPageResponseError()
    ).toMatchObject({
      status: 422,
      message: 'Unable to read the Gaming preview. Please create it again.',
    });
  });
});
