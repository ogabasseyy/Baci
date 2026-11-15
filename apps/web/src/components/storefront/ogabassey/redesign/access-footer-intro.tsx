import { Leaf } from 'lucide-react';
import type { MerchantData } from '@/hooks/merchant/types';
import { AccessStoreReviews } from './access-store-reviews';

export function AccessFooterIntro({
  merchant,
  basePath,
}: {
  merchant?: MerchantData;
  basePath: string;
}) {
  const placeId = merchant?.feature_settings?.google_place_id;
  const showReviews =
    merchant?.feature_settings?.google_reviews_enabled === true &&
    typeof placeId === 'string' &&
    placeId.trim();
  return (
    <>
      <style href="ogabassey-access-footer" precedence="high">{`
        .oa-footer-intro,.oa-store-reviews{max-width:1400px;margin:0 auto;padding:48px 24px;color:var(--store-background-text,#171717)}
        .oa-footer-intro{display:flex;gap:32px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--ogabassey-border,#ddd)}
        .oa-footer-intro h2,.oa-store-reviews h2{font-size:clamp(32px,4vw,56px);line-height:1.08;letter-spacing:-.045em;font-weight:800;margin:8px 0 16px}
        .oa-footer-intro p,.oa-store-reviews p{line-height:1.6}.oa-footer-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.12em}
        .oa-footer-intro>a{padding:16px 24px;border-radius:99px;background:var(--store-primary,#c52228);color:var(--store-primary-text,#fff);white-space:nowrap;font-weight:700}
        .oa-footer-green{display:flex;align-items:center;gap:10px;font-size:13px;margin-top:20px}.oa-footer-green svg{color:#27804b;flex-shrink:0}
        .oa-store-review-list{display:flex;gap:16px;overflow-x:auto;margin-top:24px;scroll-snap-type:x proximity;padding-bottom:12px}
        .oa-store-review-list article{flex:0 0 min(320px,85vw);padding:24px;border:1px solid var(--ogabassey-border,#ddd);border-radius:20px;scroll-snap-align:start;background:var(--ogabassey-surface,var(--store-background,#fff))}
        .oa-store-review-list blockquote{margin:16px 0;font-size:14px;line-height:1.6}.oa-store-review-list a{font-size:13px;text-decoration:underline;text-underline-offset:4px}
        @media(max-width:640px){.oa-footer-intro{align-items:start;flex-direction:column}}
      `}</style>
      {showReviews ? <AccessStoreReviews placeId={placeId} /> : null}
      <section className="oa-footer-intro" aria-label="Keep good tech going">
        <div>
          <h2>Your next chapter starts here.</h2>
          <p>Good tech. More possibilities. A little help along the way.</p>
          <p className="oa-footer-green">
            <Leaf size={20} aria-hidden="true" /> We love the environment. Let’s
            keep good tech going.
          </p>
          <p>Digital receipts. One less piece of paper.</p>
        </div>
        <a href={`${basePath}/repairs`}>Meet your repair team ↗</a>
      </section>
    </>
  );
}
