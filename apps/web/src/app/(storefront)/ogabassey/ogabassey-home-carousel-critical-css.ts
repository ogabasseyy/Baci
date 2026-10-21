/** Contain the streamed mobile & desktop hero, utility panel, ad slot, and product grid before async utility CSS arrives. */
export const OGABASSEY_HOME_CAROUSEL_CRITICAL_CSS = `@layer components{
[data-ogabassey-hero]{width:100%;background:var(--store-background,#ffffff);position:relative}
[data-ogabassey-hero]>section,[data-ogabassey-home-hero-reserve-fallback]>section{max-width:1400px;margin:0 auto;padding:1rem 1rem 0;position:relative;z-index:10;display:flex;flex-direction:column}
[data-ogabassey-hero-utility]{width:100%;background:var(--store-background, #ffffff);color:var(--store-foreground, #111827);margin:.75rem 0 1.5rem;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6}
[data-ogabassey-hero-utility] span>span:last-child{display:inline-grid;line-height:1;min-width:60px;text-align:left;vertical-align:baseline;font-weight:700;color:var(--store-primary,#d62027)}
[data-ogabassey-hero-utility] span>span:last-child>span{grid-area:1/1}
[data-ogabassey-hero-utility] span>span:last-child>span[aria-hidden="true"],[data-ogabassey-home-hero-reserve-utility]{visibility:hidden}
[data-ogabassey-hero-utility] button{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:0}
[data-ogabassey-hero-utility] button>div{width:3rem;height:3rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:var(--store-secondary,#f3f4f6);color:var(--store-secondary-text,#111827)}
[data-ogabassey-hero-utility] button>span{font-size:.75rem;line-height:1rem}
div:has(>div>div>.ogabassey-ad-slot){max-width:1400px;margin:0 auto;padding:1rem}
div:has(>div>.ogabassey-ad-slot){width:100%;display:flex;justify-content:center;align-items:center;margin:1.5rem 0}
div:has(>.ogabassey-ad-slot){display:flex;flex-direction:column;align-items:center}
.ogabassey-ad-placeholder-text{font-size:9px;line-height:1.5;margin-bottom:.25rem}
.ogabassey-ad-slot{position:relative;overflow:hidden}
.ogabassey-ad-slot>div{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ogabassey-home-products{max-width:1400px;margin:0 auto;padding:1.5rem .75rem;position:relative}
.ogabassey-home-products__header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem}
.ogabassey-home-products__eyebrow{font-size:.75rem;font-weight:700;line-height:1rem;text-transform:uppercase;color:var(--ogabassey-shell-accent-text,#ff7377)}
.ogabassey-home-products__title{color:var(--ogabassey-shell-text,#ffffff);font-size:1.25rem;font-weight:700;line-height:1.75rem;margin-top:.25rem}
.ogabassey-home-products__view-all{display:none}
.ogabassey-home-products__grid{display:grid;gap:.75rem;grid-template-columns:repeat(2,minmax(0,1fr))}
.ogabassey-home-product-card{position:relative;background:var(--ogabassey-surface,#ffffff);border:1px solid var(--ogabassey-border,#f3f4f6);border-radius:1rem;content-visibility:auto;contain-intrinsic-size:auto 360px;display:flex;flex-direction:column;height:100%;padding:.75rem}
.ogabassey-home-product-card>a{position:absolute;inset:0;z-index:0}
.ogabassey-home-product-card__media{position:relative;aspect-ratio:1 / 1;overflow:hidden;border-radius:1rem;margin-bottom:.75rem}
@media (max-width:767px){
[data-ogabassey-mobile-hero-bg-extension]{position:absolute;top:0;left:0;right:0;height:7rem;overflow:hidden;background:var(--ogabassey-shell-background,#0f0f0f);z-index:0}
[data-ogabassey-mobile-hero],[data-ogabassey-home-hero-reserve-mobile]{margin-bottom:1rem;order:1}
[data-ogabassey-mobile-hero-panel]{position:relative;height:192px;touch-action:pan-y;overflow:hidden;border-radius:1rem;background:var(--store-secondary,#f3f4f6)}
[data-ogabassey-home-hero-reserve-mobile]>:first-child{position:relative;height:192px;overflow:hidden;border-radius:1rem;background:var(--store-secondary,#f3f4f6)}
[data-ogabassey-mobile-hero-panel]>[role="group"]{position:absolute;inset:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
[data-ogabassey-mobile-hero-panel] > [aria-hidden="true"]{opacity:0;z-index:0}
[data-ogabassey-mobile-hero-panel] > [aria-hidden="false"]{opacity:1;z-index:10}
[data-ogabassey-mobile-hero-panel]>[role="group"]>:first-child{grid-column:span 3/span 3;display:flex;flex-direction:column;justify-content:center;gap:.25rem;padding:1rem 1.25rem}
[data-ogabassey-mobile-hero-panel] h2{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-size:1.65rem;font-weight:800;line-height:1.05;color:var(--store-secondary-text,#111827)}
[data-ogabassey-mobile-hero-panel] p{font-size:11px;font-weight:600;color:var(--store-secondary-text,#111827)}
[data-ogabassey-mobile-hero-panel]>[role="group"]>:first-child>span:first-child{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--store-primary,#d62027)}
[data-ogabassey-mobile-hero-panel]>[role="group"]>:first-child>span:last-child{margin-top:.5rem;display:inline-flex;width:fit-content;align-items:center;border-radius:9999px;background:var(--store-primary,#d62027);padding:.375rem 1rem;font-size:11px;font-weight:700;color:var(--store-on-primary,#ffffff)}
[data-ogabassey-mobile-hero-panel]>[role="group"]>:nth-child(2){position:relative;grid-column:span 2/span 2;display:flex;align-items:center;justify-content:center;padding:.5rem}
[data-ogabassey-mobile-hero-panel] picture{display:block;height:100%;width:100%}
[data-ogabassey-mobile-hero-panel] img{height:100%;width:100%;object-fit:contain;object-position:right;padding:.5rem}
[data-ogabassey-mobile-hero-panel]>[role="group"]>a{position:absolute;inset:0}
[data-ogabassey-mobile-hero]>:last-child:not([role="region"]),[data-ogabassey-home-hero-reserve-mobile]>:last-child{margin-top:.5rem;min-height:2.75rem;display:flex;align-items:center;gap:.5rem;padding:0 .25rem}
[data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"]{display:flex;flex:1;align-items:center;gap:.375rem}
[data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"]>button{position:relative;height:2.75rem;flex:1}
[data-ogabassey-mobile-hero] [aria-label="Hero carousel slide controls"]>button>span{position:absolute;left:0;right:0;top:50%;display:block;height:.25rem;translate:0 -50%;overflow:hidden;border-radius:9999px;background:color-mix(in srgb,var(--store-primary,#d62027) 20%,transparent)}
[data-ogabassey-mobile-hero] button[aria-pressed],[data-ogabassey-carousel-toggle-slot]{height:2.75rem;min-width:2.75rem;border-radius:9999px}
[data-ogabassey-mobile-hero] button[aria-pressed]{display:flex;align-items:center;justify-content:center;background:var(--store-primary,#d62027);color:var(--store-on-primary,#ffffff)}
[data-ogabassey-hero-utility]>:first-child{padding:0 1rem}
[data-ogabassey-hero-utility]>:nth-child(2){display:none}
[data-ogabassey-mobile-utility-panel]{min-height:158px;background:var(--store-background, #ffffff);color:var(--store-foreground, #111827);border-radius:1.5rem;border:1px solid #f3f4f6;padding:.5rem}
[data-ogabassey-mobile-utility-panel]>:first-child{border-radius:1rem;padding:.75rem 1rem;margin-bottom:1rem;text-align:center;font-size:.875rem;line-height:1.25rem;background:color-mix(in srgb,var(--store-primary,#d62027) 5%,transparent)}
[data-ogabassey-mobile-utility-panel]>:last-child{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5rem;padding:0 .25rem .5rem}
}
@media (min-width:768px){
[data-ogabassey-hero]>section,[data-ogabassey-home-hero-reserve-fallback]>section{padding:1.5rem 1.5rem 0}
[data-ogabassey-desktop-hero]>a,[data-ogabassey-desktop-hero]>div>a{position:relative;overflow:hidden;border-radius:1rem;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));background:var(--store-secondary,#f3f4f6)}
[data-ogabassey-desktop-hero]>a,[data-ogabassey-empty-desktop-hero]>:first-child,[data-ogabassey-home-hero-reserve-fallback]>section>:last-child>:first-child{height:400px;border-radius:1rem;background:var(--store-secondary,#f3f4f6)}
[data-ogabassey-empty-desktop-hero]>:nth-child(2),[data-ogabassey-home-hero-reserve-fallback]>section>:last-child>:nth-child(2){display:none}
[data-ogabassey-desktop-hero]>a>:first-child,[data-ogabassey-desktop-hero]>div>a>:first-child{grid-column:span 3/span 3;display:flex;flex-direction:column;justify-content:center;gap:.75rem;padding:2rem 2.5rem}
[data-ogabassey-desktop-hero]>a h2,[data-ogabassey-desktop-hero]>div>a h3{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-size:2.25rem;font-weight:700;line-height:1.25;color:var(--store-secondary-text,#111827)}
[data-ogabassey-desktop-hero]>a p{font-size:1.25rem;line-height:1.75rem;font-weight:600;color:var(--store-secondary-text,#111827)}
[data-ogabassey-desktop-hero]>a>:first-child>span:first-child{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.18em;color:var(--store-primary,#d62027)}
[data-ogabassey-desktop-hero]>a>:first-child>div{margin-top:.25rem;height:.375rem;width:4rem;border-radius:9999px;background:var(--store-primary,#d62027)}
[data-ogabassey-desktop-hero]>a>:first-child>span:last-child{margin-top:.75rem;display:inline-flex;width:fit-content;align-items:center;border-radius:9999px;background:var(--store-primary,#d62027);padding:.75rem 1.75rem;font-size:1rem;font-weight:700;color:var(--store-on-primary,#ffffff)}
[data-ogabassey-desktop-hero]>a>:nth-child(2),[data-ogabassey-desktop-hero]>div>a>:nth-child(2){position:relative;grid-column:span 2/span 2}
[data-ogabassey-desktop-hero] picture{position:absolute;inset:0;display:block;height:100%;width:100%}
[data-ogabassey-desktop-hero] img{height:100%;width:100%;object-fit:contain;padding:1rem}
[data-ogabassey-desktop-hero]>div{display:flex;flex-direction:column;gap:1rem;height:100%}
[data-ogabassey-desktop-hero]>div>a,[data-ogabassey-desktop-hero]>div>div,[data-ogabassey-empty-desktop-hero]>:nth-child(2)>div,[data-ogabassey-home-hero-reserve-fallback]>section>:last-child>:nth-child(2)>div{flex:1 1 0%;border-radius:1rem;background:var(--store-secondary,#f3f4f6)}
[data-ogabassey-desktop-hero]>div>a>:first-child{gap:.375rem;padding:1rem 1.25rem}
[data-ogabassey-desktop-hero]>div>a h3{-webkit-line-clamp:2;font-size:1.125rem}
[data-ogabassey-hero-utility]{margin-top:2rem;padding:1.25rem 0}
[data-ogabassey-hero-utility]>:first-child{display:none}
[data-ogabassey-hero-utility]>:nth-child(2){display:flex;max-width:1400px;min-height:92px;margin:0 auto;padding:0 1.5rem;align-items:center;justify-content:space-between}
[data-ogabassey-hero-utility]>:nth-child(2)>:first-child,[data-ogabassey-hero-utility]>:nth-child(2)>:last-child{background:color-mix(in srgb,var(--store-primary,#d62027) 5%,transparent);padding:2rem 2.5rem;border-radius:.5rem;min-width:280px;text-align:center;font-size:1.25rem;line-height:1.75rem;font-weight:500}
[data-ogabassey-hero-utility]>:nth-child(2)>:nth-child(2){display:flex;justify-content:center;gap:3rem;flex-wrap:wrap}
.ogabassey-home-products{padding:2rem 1.5rem}
.ogabassey-home-products__header{margin-bottom:2rem}
.ogabassey-home-products__title{font-size:1.875rem;line-height:2.25rem}
.ogabassey-home-products__view-all{display:block;font-size:1rem;line-height:1.5rem}
.ogabassey-home-products__grid{gap:1.5rem;grid-template-columns:repeat(3,minmax(0,1fr))}
.ogabassey-home-product-card{padding:1rem}
.ogabassey-home-product-card__media{margin-bottom:1rem}
}
@media (min-width:1024px){
[data-ogabassey-desktop-hero]>a{grid-column:span 5/span 5;height:100%}
[data-ogabassey-desktop-hero]:has(>div)>a,[data-ogabassey-empty-desktop-hero]>:first-child,[data-ogabassey-home-hero-reserve-fallback]>section>:last-child>:first-child{grid-column:span 3/span 3;height:100%}
[data-ogabassey-desktop-hero]>a>:first-child{padding:2rem 4rem}
[data-ogabassey-desktop-hero]>a h2{font-size:3rem}
[data-ogabassey-desktop-hero]>div,[data-ogabassey-empty-desktop-hero]>:nth-child(2),[data-ogabassey-home-hero-reserve-fallback]>section>:last-child>:nth-child(2){display:flex;flex-direction:column;gap:1rem;height:100%;grid-column:span 2/span 2}
.ogabassey-home-products__grid{grid-template-columns:repeat(4,minmax(0,1fr))}
}
}`.trim();
