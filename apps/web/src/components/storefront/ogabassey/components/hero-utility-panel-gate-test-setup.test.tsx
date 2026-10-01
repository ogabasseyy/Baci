import { describe, expect, it } from 'vitest';
import { renderGate } from './hero-utility-panel-gate-test-setup';

describe('hero-utility-panel-gate-test-setup', () => {
  it('renders the server fallback while the panel module is pending', () => {
    renderGate(() => new Promise<never>(() => {}));

    expect(
      document.querySelector('[data-ogabassey-hero-utility="true"]')
    ).toBeInTheDocument();
  });
});
