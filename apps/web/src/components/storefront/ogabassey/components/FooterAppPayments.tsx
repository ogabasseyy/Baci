import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import Image from 'next/image';

const APP_STORE_BADGE_SRC = '/badges/app-store-black.svg';
const GOOGLE_PLAY_BADGE_SRC = '/badges/google-play.svg';

export function FooterAppPayments() {
  return (
    <div>
      <h3 className="text-sm font-bold mb-4 text-current uppercase tracking-wider">
        Download App
      </h3>
      <div className="flex gap-2 mb-6">
        {OGABASSEY_STOREFRONT_APP_STORE_URL ? (
          <a
            href={OGABASSEY_STOREFRONT_APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download on the App Store"
            className="inline-flex transition-opacity hover:opacity-90"
          >
            <Image
              src={APP_STORE_BADGE_SRC}
              alt="Download on the App Store"
              width={120}
              height={40}
              className="h-10 w-auto"
            />
          </a>
        ) : null}
        <a
          href={OGABASSEY_STOREFRONT_PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Get it on Google Play"
          className="inline-flex transition-opacity hover:opacity-90"
        >
          <Image
            src={GOOGLE_PLAY_BADGE_SRC}
            alt="Get it on Google Play"
            width={135}
            height={40}
            className="h-10 w-auto"
          />
        </a>
      </div>

      <div className="flex items-center gap-3 mt-1">
        <span className="text-xs text-current/65 font-medium">
          Secured by:
        </span>
        <div className="flex items-center gap-1 bg-store-background px-2 py-1 rounded border border-store-border shadow-sm opacity-90 hover:opacity-100 transition-opacity">
          <svg
            viewBox="0 0 24 24"
            className="size-4 text-store-primary fill-current"
            aria-hidden="true"
          >
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span className="text-[10px] font-bold text-store-background-text tracking-tight">
            Paystack
          </span>
        </div>

        <div className="flex items-center gap-1 bg-store-background px-2 py-1 rounded border border-store-border shadow-sm opacity-90 hover:opacity-100 transition-opacity">
          <svg
            viewBox="0 0 24 24"
            className="size-4 text-store-primary fill-current"
            aria-hidden="true"
          >
            <path d="M12 2L2 22h10l10-20H12zm0 6l-5 10h10L12 8z" />
          </svg>
          <span className="text-[10px] font-bold text-store-background-text tracking-tight">
            Flutterwave
          </span>
        </div>
      </div>
    </div>
  );
}
