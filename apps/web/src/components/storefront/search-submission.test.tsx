import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchSubmissionForm } from './search-submission';
import { SearchSubmissionLink } from './search-submission-link';

const fetchMock = vi.fn();
describe('search submission controls', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps a native GET form with q for no-JS search and emits only on submit', () => {
    render(<SearchSubmissionForm pathPrefix="/ogabassey" query="old phone" />);
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    const form = input.closest('form');
    expect(form).toHaveAttribute('action', '/ogabassey/search');
    expect(form).toHaveAttribute('method', 'get');
    expect(input).toHaveAttribute('name', 'q');
    fireEvent.change(input, { target: { value: ' new phone ' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.submit(form as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/search/submissions',
      expect.objectContaining({
        body: JSON.stringify({
          query: 'new phone',
          pathPrefix: '/ogabassey',
          source: 'results-form',
        }),
        keepalive: true,
      })
    );
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
    const query = `${'a'.repeat(99)}😀extra`;
    render(
      <SearchSubmissionLink pathPrefix="" query={query} source="see-all">
        See all results
      </SearchSubmissionLink>
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/search?q=${'a'.repeat(99)}`);
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toBe(
      'a'.repeat(99)
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

  it('does not block submission when tracking throws or rejects', async () => {
    render(<SearchSubmissionForm pathPrefix="" query="phone" />);
    const form = screen
      .getByRole('searchbox')
      .closest('form') as HTMLFormElement;
    fetchMock.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const firstEvent = new Event('submit', { bubbles: true, cancelable: true });
    expect(() => fireEvent(form, firstEvent)).not.toThrow();
    expect(firstEvent.defaultPrevented).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const secondEvent = new Event('submit', {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(form, secondEvent);
    await Promise.resolve();
    expect(secondEvent.defaultPrevented).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clamps a retained over-long query so displayed, navigated, and recorded values match', () => {
    render(
      <SearchSubmissionForm pathPrefix="/ogabassey" query={'q'.repeat(150)} />
    );
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    expect(input).toHaveValue('q'.repeat(100));
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/search/submissions',
      expect.objectContaining({
        body: JSON.stringify({
          query: 'q'.repeat(100),
          pathPrefix: '/ogabassey',
          source: 'results-form',
        }),
      })
    );
  });

  it('does not emit for an empty form submission', () => {
    render(<SearchSubmissionForm pathPrefix="" query=" " />);
    fireEvent.submit(
      screen.getByRole('searchbox').closest('form') as HTMLFormElement
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
