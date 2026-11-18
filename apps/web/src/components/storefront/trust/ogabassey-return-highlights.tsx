import {
  OGABASSEY_ASSURANCE_SUMMARY,
  OGABASSEY_QUALITY_CHECKS,
} from '@baci/shared';
import {
  Camera,
  ClipboardCheck,
  PackageCheck,
  ShieldCheck,
} from 'lucide-react';
import { hasPublishableWarrantyPolicy } from '@/lib/storefront-trust/build-merchant-trust-profile';
import type { MerchantTrustProfile } from '@/lib/storefront-trust/merchant-trust-profile-types';

export function OgabasseyReturnHighlights({
  trustProfile,
}: {
  trustProfile: MerchantTrustProfile;
}) {
  return (
    <>
      <section className="mt-8 rounded-2xl border border-store-border p-5">
        <h2 className="text-lg font-semibold">Three checks before delivery</h2>
        <ol className="mt-4 space-y-4">
          {OGABASSEY_QUALITY_CHECKS.map(({ title, body }, index) => (
            <li
              key={title}
              className="flex gap-3 rounded-xl bg-store-background-text/5 p-3"
            >
              <span aria-hidden="true" className="font-bold text-store-primary">
                {index === 0 ? (
                  <ClipboardCheck size={18} />
                ) : index === 1 ? (
                  <PackageCheck size={18} />
                ) : (
                  <Camera size={18} />
                )}
              </span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <aside className="mt-6 rounded-2xl border border-store-border p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} aria-hidden="true" />
          Ogabassey Assurance
        </h2>
        <p className="mt-2 text-sm">{OGABASSEY_ASSURANCE_SUMMARY}</p>
        {hasPublishableWarrantyPolicy(trustProfile) && (
          <a href="./warranty" className="mt-2 inline-block underline">
            See device coverage
          </a>
        )}
      </aside>
    </>
  );
}
