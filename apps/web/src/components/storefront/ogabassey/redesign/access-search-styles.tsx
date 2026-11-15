const SEARCH_STYLES = `
.oa-search-slot{display:flow-root}
.oa-search-slot[data-docked=true]{block-size:var(--oa-search-slot-height)}
.oa-search-slot[data-docked=true]>search{position:fixed;top:var(--oa-search-top,0px);left:0;right:0;z-index:60;padding:8px 20px;background:var(--oa-paper);border-bottom:1px solid var(--oa-line);box-shadow:0 6px 16px #0000000d}
.oa-search-slot[data-docked=true] .oa-hero-search{margin:0 auto;min-height:54px;box-shadow:none}
.oa-search-slot[data-docked=true] .oa-search-submit{min-height:40px;padding-block:8px}
body:has([data-ogabassey-access-hero][data-search-placement]) .ogabassey-navbar__search-wrap{display:none}
.ogabassey-navbar[data-oa-search-docked=true]{transform:none}
@media(max-width:767px){.oa-search-slot[data-docked=true]>search{padding:8px 12px}}

.oa-hero-search{display:flex;align-items:center;gap:12px;width:min(100%,650px);min-height:68px;margin:26px auto 20px;padding:6px 7px 6px 22px;border:2px solid var(--oa-red);border-radius:999px;background:var(--oa-paper);box-shadow:0 5px 0 color-mix(in srgb,var(--oa-red) 9%,transparent);text-align:left}
.oa-hero-search .oa-search-icon{flex-shrink:0;color:var(--oa-ink);opacity:.65}.oa-hero-search input{flex:1;min-width:0;width:100%;padding:12px 0;font:inherit;font-size:16px;border:0;background:transparent;color:var(--oa-ink);outline:none}.oa-hero-search input::placeholder{color:color-mix(in srgb,var(--oa-ink) 62%,var(--oa-paper));opacity:1}.oa-hero-search:focus-within{outline:3px solid var(--oa-ink);outline-offset:4px}.oga-access .oa-search-submit{display:flex;align-items:center;justify-content:center;gap:12px;min-height:50px;padding:12px 24px;border:0;border-radius:999px;background:var(--oa-red);color:var(--store-primary-text,#fff);font-size:14px;font-weight:750;flex-shrink:0}.oa-hero-search-reserve{height:68px}
[data-search-placement] .oa-intro .oa-actions{gap:28px}[data-search-placement] .oa-hero-description{max-width:570px}[data-search-placement=above-description] .oa-hero-description{margin-top:24px;margin-bottom:12px}[data-search-placement=below-description] .oa-hero-description{margin-bottom:20px}[data-search-placement] .oa-intro .oa-note{margin-top:16px}
.oa-service-nav{display:flex;align-items:center;justify-content:space-evenly;gap:24px;width:100%}.oa-service-nav a{display:inline-flex;align-items:center;gap:8px;min-height:44px;white-space:nowrap;font-size:14px;font-weight:600}.oa-service-nav svg{width:18px;height:18px;flex-shrink:0}.oa-service-nav a:focus-visible{outline:3px solid currentColor;outline-offset:3px;border-radius:4px}.oa-service-nav a:hover{text-decoration:underline;text-underline-offset:5px}
@media(max-width:1100px){.oa-service-nav{gap:16px}.oa-service-nav a{font-size:14px}}
@media(max-width:767px){.oa-hero-search{min-height:60px;margin:24px auto 18px;padding:5px 5px 5px 14px;gap:8px}.oa-hero-search input{font-size:16px;padding:10px 0}.oa-hero-search .oa-search-icon{width:17px;height:17px}.oga-access .oa-search-submit{padding:10px 16px;min-height:46px;font-size:12px;gap:6px}.oa-search-submit svg{display:none}.oa-hero-search-reserve{height:60px}[data-search-placement] .oa-intro .oa-actions{gap:22px}[data-search-placement] .oa-hero-description{max-width:360px}.oa-service-nav{gap:16px;justify-content:flex-start;overflow-x:auto;scrollbar-width:thin;overscroll-behavior-x:contain;width:100%;padding:0 20px}.oa-service-nav a{font-size:13px;min-height:44px}}
@media(max-width:360px){.oa-hero-search{padding-left:12px;gap:6px}.oa-hero-search .oa-search-icon{display:none}.oa-hero-search input{font-size:16px}.oga-access .oa-search-submit{padding-inline:13px}}
`;

export function AccessSearchStyles() {
  return (
    <style href="ogabassey-search-experiments" precedence="high">
      {SEARCH_STYLES}
    </style>
  );
}
