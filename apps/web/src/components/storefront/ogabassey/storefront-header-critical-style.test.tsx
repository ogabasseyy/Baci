import { render } from '@testing-library/react';
import postcss from 'postcss';
import { expect, it } from 'vitest';
import { OgabasseyHeaderCriticalStyle } from './storefront-header-critical-style';

it('anchors sticky header actions on mobile without emitting mobile bottom-footer rules', () => {
  render(<OgabasseyHeaderCriticalStyle />);
  const navbarValues: Record<string, string> = {};
  const actionValues: Record<string, string> = {};
  const iconLinkValues: Record<string, string> = {};
  const desktopActionValues: Record<string, string> = {};
  const desktopIconLinkValues: Record<string, string> = {};
  let hasMobileFooterRule = false;
  for (const style of document.querySelectorAll('style')) {
    const root = postcss.parse(style.textContent ?? '');
    root.walkRules('.ogabassey-navbar', (rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
        return;
      }
      rule.walkDecls((decl) => {
        navbarValues[decl.prop] = decl.value;
      });
    });
    root.walkRules('.ogabassey-navbar__desktop-actions', (rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
        rule.walkDecls((decl) => {
          desktopActionValues[decl.prop] = decl.value;
        });
        return;
      }
      rule.walkDecls((decl) => {
        actionValues[decl.prop] = decl.value;
      });
    });
    root.walkRules('.ogabassey-navbar__icon-link', (rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
        rule.walkDecls((decl) => {
          desktopIconLinkValues[decl.prop] = decl.value;
        });
        return;
      }
      rule.walkDecls((decl) => {
        iconLinkValues[decl.prop] = decl.value;
      });
    });
    root.walkRules(/\.ogabassey-mobile-footer/, () => {
      hasMobileFooterRule = true;
    });
  }
  expect(navbarValues.position).toBe('sticky');
  expect(navbarValues.top).toBe('0');
  expect(actionValues.display).toBe('flex');
  expect(actionValues.order).toBe('2');
  expect(actionValues.position).toBe('relative');
  expect(actionValues.gap).toBe('0.5rem');
  expect(iconLinkValues.width).toBe('2.75rem');
  expect(iconLinkValues.height).toBe('2.75rem');
  expect(desktopActionValues.gap).toBe('1.25rem');
  expect(desktopIconLinkValues.width).toBe('auto');
  expect(desktopIconLinkValues.height).toBe('auto');
  expect(hasMobileFooterRule).toBe(false);
});

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
