import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceBankLogo } from './FinanceBankLogo';

function renderLogo(name: string, code: string): HTMLElement {
  const { container } = render(<FinanceBankLogo name={name} code={code} />);
  const wrapper = container.firstElementChild;

  if (!(wrapper instanceof HTMLElement)) {
    throw new Error('FinanceBankLogo rendered no wrapper element');
  }

  return wrapper;
}

describe('finance bank logo', () => {
  it('renders the supplied logo for a known bank name', () => {
    const wrapper = renderLogo('Citi Bank', '');

    expect(wrapper.querySelector('img')).not.toBeNull();
    expect(wrapper.querySelector('svg')).toBeNull();
  });

  it('matches known bank names case-insensitively and ignoring padding', () => {
    const wrapper = renderLogo('  cItI bAnK  ', '');

    expect(wrapper.querySelector('img')).not.toBeNull();
  });

  it('prefers the named logo over the bank-code fallback', () => {
    const wrapper = renderLogo('Suntrust Bank', '044');

    const image = wrapper.querySelector('img');

    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toContain('suntrust');
  });

  it('falls back to the Oxygen bank logo when no name or code is mapped', () => {
    const wrapper = renderLogo('Neo Bank Not In The Asset List', '');

    expect(wrapper.querySelector('img')).toBeNull();
    expect(wrapper.querySelector('svg')).not.toBeNull();
  });

  it('stays decorative for assistive technology while exposing the bank name', () => {
    const wrapper = renderLogo('Jaiz Bank', '');

    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveAttribute('data-bank', 'Jaiz Bank');
  });
});
