import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaMappingDraftPanel } from './jumia-mapping-draft-panel';

const sid = '11111111-1111-4111-8111-111111111111';
vi.mock('./category-selector', () => ({
  JumiaCategorySelector: ({
    onSelect,
  }: {
    onSelect: (category: {
      code: number;
      name: string;
      attributeSetId: string;
    }) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onSelect({ code: 1, name: 'Games', attributeSetId: sid })
        }
      >
        Choose draft Games
      </button>
      <button
        type="button"
        onClick={() =>
          onSelect({ code: 2, name: 'Phones', attributeSetId: sid })
        }
      >
        Choose draft Phones
      </button>
    </>
  ),
}));
vi.mock('./brand-selector', () => ({
  JumiaBrandSelector: ({
    onSelect,
  }: {
    onSelect: (brand: { code: number; name: string }) => void;
  }) => (
    <button type="button" onClick={() => onSelect({ code: 1, name: 'Brand' })}>
      Choose draft brand
    </button>
  ),
}));
const clients = {
  businessClients: [
    { code: 'jumia-ng', name: 'Nigeria', countryCode: 'NG' },
    { code: 'jumia-gh', name: 'Ghana', countryCode: 'GH' },
  ],
};
const attributes = {
  attributes: [
    {
      code: 1,
      name: 'Enabled',
      description: '',
      type: 6,
      mandatory: true,
      variation: false,
      translatable: false,
    },
  ],
};
function chooseClient(code = 'jumia-ng') {
  fireEvent.change(screen.getByLabelText('Draft destination business client'), {
    target: { value: code },
  });
}
async function mapCategory() {
  chooseClient();
  fireEvent.click(screen.getByText('Choose draft Games'));
  fireEvent.click(screen.getByText('Choose draft brand'));
  await screen.findByLabelText('Enabled (required)');
}
describe('destination-scoped mapping drafts', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.includes('destination-context') ? clients : attributes
          )
        )
      )
    )
  );
  afterEach(() => vi.unstubAllGlobals());
  it('requires explicit business client selection before metadata loads; draft never writes', async () => {
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
      />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    expect(
      screen.getByLabelText('Draft destination business client')
    ).toHaveValue('');
    expect(screen.queryByText('Choose draft Games')).not.toBeInTheDocument();
    await mapCategory();
    expect(
      screen.getByText(/brand availability is unverified for jumia-ng/i)
    ).toBeInTheDocument();
    const confirm = screen.getByRole('button', {
      name: 'Confirm draft category: Games',
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'false' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Draft category confirmed: Games'
    );
    expect(
      screen.getByText(/later provider and source validation/i)
    ).toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([url, options]) =>
            !String(url).includes('export') &&
            (!options?.method || options.method === 'GET')
        )
    ).toBe(true);
  });

  it('clears the parent draft when its selected business-client controls unmount', async () => {
    const onDraftChange = vi.fn();
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
        onDraftChange={onDraftChange}
      />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    await mapCategory();
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'false' },
    });
    await waitFor(() =>
      expect(onDraftChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          businessClientCode: 'jumia-ng',
          categoryConfirmed: false,
        })
      )
    );

    chooseClient('');
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(null));
  });

  it('clears attributes and confirmation when category is replaced even with the same set SID', async () => {
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
      />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    await mapCategory();
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'false' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm draft category: Games' })
    );
    fireEvent.click(screen.getByText('Choose draft Phones'));
    await screen.findByLabelText('Enabled (required)');
    expect(screen.getByLabelText('Enabled (required)')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Confirm draft category: Phones' })
    ).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('revokes confirmation after any attribute or brand edit, including a revert', async () => {
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
      />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    await mapCategory();
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'false' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm draft category: Games' })
    );
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'true' },
    });
    fireEvent.change(screen.getByLabelText('Enabled (required)'), {
      target: { value: 'false' },
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm draft category: Games' })
    );
    fireEvent.click(screen.getByText('Choose draft brand'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows retry on a failed destination read, and an actionable empty state without auto-selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('token'))
        .mockResolvedValueOnce(Response.json({ businessClients: [] }))
    );
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be loaded/i
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry destinations' }));
    expect(
      await screen.findByText(/No active authorized business clients/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Draft destination business client')
    ).toHaveValue('');
    expect(screen.queryByText('Choose draft Games')).not.toBeInTheDocument();
  });
  it('clears choices on client/integration switches and ignores old attribute results', async () => {
    let resolveOld: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('attribute-sets')
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : Promise.resolve(Response.json(clients))
      )
    );
    const { rerender } = render(
      <JumiaMappingDraftPanel merchantId="merchant" integrationId="old" />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    chooseClient();
    fireEvent.click(screen.getByText('Choose draft Games'));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) => String(url).includes('attribute-sets'))
      ).toBe(true)
    );
    chooseClient('jumia-gh');
    expect(
      screen.queryByText('Confirm draft category: Games')
    ).not.toBeInTheDocument();
    await act(async () => {
      resolveOld(Response.json(attributes));
    });
    expect(
      screen.queryByLabelText('Enabled (required)')
    ).not.toBeInTheDocument();
    rerender(
      <JumiaMappingDraftPanel merchantId="merchant" integrationId="new" />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    expect(
      screen.getByLabelText('Draft destination business client')
    ).toHaveValue('');
  });
  it('blocks required unsupported metadata and provides retry and empty-context states', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(clients))
        .mockResolvedValueOnce(
          Response.json({
            attributes: [{ ...attributes.attributes[0], type: 99 }],
          })
        )
    );
    render(
      <JumiaMappingDraftPanel
        merchantId="merchant"
        integrationId="integration"
      />
    );
    await screen.findByRole('option', { name: 'Nigeria (jumia-ng)' });
    chooseClient();
    fireEvent.click(screen.getByText('Choose draft Games'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be loaded/i
    );
    expect(
      screen.getByRole('button', { name: 'Confirm draft category: Games' })
    ).toBeDisabled();
    expect(
      within(
        screen.getByRole('region', { name: 'Jumia mapping draft' })
      ).getByRole('button', { name: 'Retry metadata' })
    ).toBeInTheDocument();
  });
});
