import { describe, expect, it } from 'vitest';
import { shouldRouteGraphicsChangeThroughServer } from './category-graphics-routing';

describe('shouldRouteGraphicsChangeThroughServer', () => {
  it('routes through the server when client filters are unavailable', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: false,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(true);
  });

  it('routes through the server for a URL-driven selection', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: true,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: true,
      })
    ).toBe(true);
  });

  it('keeps graphics local when the full set is loaded with no URL selection', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: true,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(false);
  });

  it('is false without a server graphics filter', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: false,
        hasServerGraphicsFilter: false,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(false);
  });
});
