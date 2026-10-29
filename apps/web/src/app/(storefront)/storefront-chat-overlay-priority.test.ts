import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from './storefront-css-partition-read';

const overlayCss = readStorefrontFile('storefront-chat-overlay-priority.css');

describe('storefront chat overlay priority CSS', () => {
  it('loads with core storefront CSS to avoid a deferred-style overlap flash', () => {
    expect(readStorefrontFile('storefront-core.css')).toMatch(
      /@import\s+["']\.\/storefront-chat-overlay-priority\.css["']/
    );
    expect(overlayCss.split('\n').length).toBeLessThanOrEqual(300);
  });

  it('keeps consent visible when an open conversation is present', () => {
    expect(overlayCss).not.toMatch(
      /body:has\(\.ogabassey-chat-anchor\s+\.ogabassey-chat-window\)[\s\S]*?\.storefront-cookie-consent\s*\{\s*display:\s*none/
    );
  });

  it('keeps a non-modal consent launcher keyboard reachable and hides promotions', () => {
    expect(overlayCss).toMatch(
      /body:has\(\.storefront-cookie-consent\)\s+\.ogabassey-chat-anchor:not\(:has\(\.ogabassey-chat-window\)\):not\(\s*:focus-within\s*\):not\(\s*\[data-chat-launcher-dragging\]\s*\)/
    );
    expect(overlayCss).toMatch(
      /body:has\(\.storefront-cookie-consent\)[\s\S]*?\.ogabassey-chat-anchor[^{}]*\{\s*opacity:\s*0;\s*pointer-events:\s*none/
    );
    expect(overlayCss).toMatch(
      /body:has\(\.storefront-cookie-consent\)[\s\S]*?\.ogabassey-chat-anchor[^{}]*:focus-within\s*\{\s*opacity:\s*1;\s*pointer-events:\s*auto;\s*z-index:\s*101/
    );
    expect(overlayCss).toMatch(
      /body:has\(\.storefront-cookie-consent\)\s+\.ogabassey-offer-popup,[\s\S]*?\.ogabassey-newsletter-popup\s*\{\s*display:\s*none/
    );
  });

  it('protects an open or keyboard-focused chat from promotional overlays', () => {
    expect(overlayCss).toMatch(
      /body:has\(\.ogabassey-chat-anchor\s+\.ogabassey-chat-window\)[\s\S]*?\.ogabassey-offer-popup,[\s\S]*?\.ogabassey-newsletter-popup\s*\{\s*display:\s*none/
    );
    expect(overlayCss).toMatch(
      /body:has\(\.ogabassey-chat-anchor:focus-within\)\s+\.ogabassey-offer-popup,[\s\S]*?\.ogabassey-newsletter-popup\s*\{\s*display:\s*none/
    );
  });

  it('limits popup focus suppression to keyboard handoff from the chat launcher', () => {
    expect(overlayCss).toMatch(
      /body\[data-chat-promotion-focus-handoff=["']true["']\][\s\S]*?\.ogabassey-offer-popup\s*,[\s\S]*?\.ogabassey-newsletter-popup\s*\{\s*opacity:\s*0;\s*pointer-events:\s*none/
    );
    expect(overlayCss).not.toMatch(/body:has\(:focus-visible\)/);
  });

  it('limits launcher suppression for the offer to narrow viewports', () => {
    expect(overlayCss).toMatch(
      /@media\s*\(max-width:\s*423px\)[\s\S]*?body:has\(\.ogabassey-offer-popup\):not\(:has\(\.storefront-cookie-consent\)\):not\([\s\S]*?data-chat-promotion-focus-handoff[\s\S]*?\.ogabassey-chat-anchor[\s\S]*?opacity:\s*0;\s*pointer-events:\s*none/
    );
    const narrowOfferRule = overlayCss.slice(
      overlayCss.indexOf('@media (max-width: 423px)')
    );
    expect(narrowOfferRule).toMatch(
      /\.ogabassey-chat-anchor[\s\S]*?:not\(\s*\[data-chat-launcher-positioned\]\s*\)/
    );
    expect(narrowOfferRule).toMatch(
      /\.ogabassey-chat-anchor[\s\S]*?opacity:\s*0;\s*pointer-events:\s*none/
    );
  });

  it('keeps promo-suppressed launchers keyboard reachable', () => {
    expect(overlayCss).toMatch(
      /body:has\(\.ogabassey-newsletter-popup\)[\s\S]*?\.ogabassey-chat-anchor[\s\S]*?opacity:\s*0;\s*pointer-events:\s*none/
    );
    expect(overlayCss).toMatch(
      /body:has\(\.ogabassey-offer-popup\)[\s\S]*?\.ogabassey-chat-anchor[\s\S]*?opacity:\s*0;\s*pointer-events:\s*none/
    );
  });
});
