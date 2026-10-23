import { render } from '@testing-library/react';
import postcss from 'postcss';
import { expect, it } from 'vitest';
import { OgabasseyHeaderCriticalStyle } from './storefront-header-critical-style';

it('provides first-render icon geometry without loading an external sheet', () => {
  render(<OgabasseyHeaderCriticalStyle />);
  const values: Record<string, string> = {};
  for (const style of document.querySelectorAll('style')) {
    postcss
      .parse(style.textContent ?? '')
      .walkRules('.ogabassey-navbar-search__icon', (rule) => {
        rule.walkDecls((decl) => {
          values[decl.prop] = decl.value;
        });
      });
  }
  expect(values.width).toBe('1.25rem');
  expect(values.height).toBe('1.25rem');
  expect(values.position).toBe('absolute');
  expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
});
