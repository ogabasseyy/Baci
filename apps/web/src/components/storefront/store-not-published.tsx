import { ArrowUpRight, Sparkles, Store } from 'lucide-react';
import { STORE_NOT_PUBLISHED_CSS } from './store-not-published-css';

interface StoreNotPublishedProps {
  businessName: string;
}

export function StoreNotPublished({ businessName }: StoreNotPublishedProps) {
  const storeInitial = businessName.trim().charAt(0).toUpperCase() || 'B';

  return (
    <main className="unpublished-store">
      <style>{STORE_NOT_PUBLISHED_CSS}</style>
      <div aria-hidden="true" className="unpublished-store__glow" />
      <section className="unpublished-store__notice">
        <header className="unpublished-store__header">
          <div aria-hidden="true" className="unpublished-store__monogram">
            <span>{storeInitial}</span>
          </div>
          <div className="unpublished-store__status">
            <span
              aria-hidden="true"
              className="unpublished-store__status-dot"
            />
            <span>Opening soon</span>
          </div>
        </header>

        <div className="unpublished-store__content">
          <p className="unpublished-store__eyebrow">
            <Sparkles aria-hidden="true" size={15} />A new shopping destination
          </p>
          <h1 className="unpublished-store__title">{businessName}</h1>
          <p className="unpublished-store__message">
            We&apos;re curating something worth the wait. Fresh finds,
            thoughtful details, and a brand-new storefront are almost ready for
            you.
          </p>
        </div>

        <footer className="unpublished-store__footer">
          <div className="unpublished-store__store-mark">
            <Store aria-hidden="true" size={18} />
            <span>Check back shortly</span>
          </div>
          <a className="unpublished-store__owner-link" href="/login">
            Continue setting up your store
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </footer>
      </section>
      <p className="unpublished-store__signature">Storefront powered by Baci</p>
    </main>
  );
}
