import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';
import styles from '@/components/payments/oxygen/OxygenApplicationDialog.module.css';
import { OxygenFormProgress } from '@/components/payments/oxygen/OxygenFormProgress';
import { OxygenVerificationTrust } from '@/components/payments/oxygen/OxygenVerificationTrust';

/** Exercises the real dialog stylesheet inside the Ogabassey theme boundary. */
export default function OxygenThemeFixture() {
  return (
    <div className="storefront-variant-ogabassey storefront-mode-system">
      <div className="ogabassey-storefront-shell">
        <div className="ogabassey-checkout-page">
          <dialog
            open
            aria-label="Oxygen theme fixture"
            className={`${styles.dialog} bg-white`}
          >
            <div className={styles.body}>
              <div className="grid gap-5 p-6">
                <OxygenFormProgress step={0} />
                <h3 className="text-lg font-bold text-gray-900">
                  Verify your identity
                </h3>
                <label className="text-gray-700">
                  BVN
                  <input className="border border-gray-200 bg-white text-gray-900" />
                </label>
                <OxygenVerificationTrust />
              </div>
            </div>
          </dialog>
        </div>
      </div>
    </div>
  );
}
