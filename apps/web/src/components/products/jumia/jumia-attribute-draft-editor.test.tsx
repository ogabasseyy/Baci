import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JumiaAttributeDraftEditor } from './jumia-attribute-draft-editor';

vi.mock('./jumia-attribute-fields', () => ({
  JumiaAttributeFields: ({
    onChange,
  }: {
    onChange: (code: string, value: boolean) => void;
  }) => (
    <button type="button" onClick={() => onChange('42', true)}>
      Set required attribute
    </button>
  ),
}));

const destination = {
  merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  integrationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  businessClientCode: 'NG-RETAIL',
  countryCode: 'NG',
};
const category = {
  code: 7,
  name: 'Gaming',
  attributeSetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const brand = { code: 2, name: 'Nintendo' };
const attributes = {
  attributes: [
    {
      code: 42,
      name: 'Wireless',
      description: '',
      type: 6,
      mandatory: true,
      variation: false,
      translatable: false,
    },
  ],
};

describe('JumiaAttributeDraftEditor', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('emits exact category mapping intent only after the merchant confirms it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(attributes)))
    );
    const onDraftChange = vi.fn();
    const onDraftRevision = vi.fn();
    render(
      <JumiaAttributeDraftEditor
        destination={destination}
        category={category}
        brand={brand}
        revision={0}
        onDraftChange={onDraftChange}
        onDraftRevision={onDraftRevision}
      />
    );

    await screen.findByText('Confirm draft category: Gaming');
    fireEvent.click(
      screen.getByRole('button', { name: 'Set required attribute' })
    );
    fireEvent.change(screen.getByLabelText('Product bullets (one per line)'), {
      target: { value: 'A\nB\nC\nD' },
    });
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({ categoryConfirmed: false })
      )
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm draft category: Gaming' })
    );
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenCalledWith(
        expect.objectContaining({
          category,
          brand,
          attributes: { '42': true },
          bullets: ['A', 'B', 'C', 'D'],
          categoryConfirmed: true,
        })
      )
    );
    expect(onDraftRevision).toHaveBeenCalledTimes(1);
  });
});
