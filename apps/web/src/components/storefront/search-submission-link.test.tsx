import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSubmissionLink } from './search-submission-link';

const fetchMock = vi.fn();
describe('search submission link', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it.each([
    'see-all',
    'did-you-mean',
  ] as const)('retains a native link for %s and emits only on activation', (source) => {
    const props = {
      pathPrefix: '',
      query: 'phone & case',
      source,
      children: 'Search suggestion',
    };
    expect(renderToStaticMarkup(<SearchSubmissionLink {...props} />)).toContain(
      'href="/search?q=phone%20%26%20case"'
    );
    render(<SearchSubmissionLink {...props} />);
    expect(fetchMock).not.toHaveBeenCalled();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/search?q=phone%20%26%20case');
    fireEvent.mouseOver(link);
    fireEvent.focus(link);
    expect(fetchMock).not.toHaveBeenCalled();
    // Cancel jsdom navigation after React has handled the click.
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      query: 'phone & case',
      pathPrefix: '',
      source,
    });
  });

  it('truncates astral characters without splitting surrogate pairs', () => {
    const query = `${'a'.repeat(199)}😀extra`;
    render(
      <SearchSubmissionLink pathPrefix="" query={query} source="see-all">
        See all results
      </SearchSubmissionLink>
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/search?q=${'a'.repeat(199)}`);
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toBe(
      'a'.repeat(199)
    );
  });

  it('records middle-button link activation without counting other auxiliary clicks', () => {
    render(
      <SearchSubmissionLink pathPrefix="" query="phone" source="see-all">
        See all results
      </SearchSubmissionLink>
    );
    const link = screen.getByRole('link');
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).source).toBe('see-all');
  });

  it('does not block navigation when tracking throws or rejects', async () => {
    render(
      <SearchSubmissionLink pathPrefix="" query="phone" source="see-all">
        See all results
      </SearchSubmissionLink>
    );
    const link = screen.getByRole('link');
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    link.addEventListener('click', (event) => event.preventDefault());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(() => fireEvent(link, event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
