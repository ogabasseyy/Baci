'use client';

import {
  CheckCircle2,
  Handshake,
  MessageCircle,
  Smartphone,
  Sparkles,
  Tag,
  Ticket,
} from 'lucide-react';
import { useState } from 'react';

type ShowcaseMode = 'negotiation' | 'discounts' | 'mobile-admin';

const LIST_PRICE = 120_000;

export function ProductShowcase() {
  const [mode, setMode] = useState<ShowcaseMode>('negotiation');
  const [offerAmount, setOfferAmount] = useState<number>(118_000);
  const [appliedCode, setAppliedCode] = useState<
    'WELCOME10' | 'VIP5000' | null
  >('WELCOME10');
  const [negotiationApproved, setNegotiationApproved] =
    useState<boolean>(false);

  const isAutoAccepted = offerAmount >= 117_600; // within 2% auto-negotiation floor
  const counterOffer = 117_600;

  const discountAmount =
    appliedCode === 'WELCOME10'
      ? Math.round(LIST_PRICE * 0.1)
      : appliedCode === 'VIP5000'
        ? 5_000
        : 0;
  const finalTotal = LIST_PRICE - discountAmount;

  return (
    <div className="mt-16 rounded-3xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 lg:p-10 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent mb-2">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>Interactive Preview</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary dark:text-white">
            See Baci&apos;s built-in commerce tools in action
          </h3>
        </div>

        <div
          role="tablist"
          aria-label="Interactive product preview modes"
          className="inline-flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800"
        >
          {(
            [
              {
                id: 'negotiation',
                label: 'Price Negotiation',
                Icon: Handshake,
              },
              {
                id: 'discounts',
                label: 'Discounts & Loyalty',
                Icon: Ticket,
              },
              {
                id: 'mobile-admin',
                label: 'Mobile Admin',
                Icon: Smartphone,
              },
            ] as const
          ).map(({ id, label, Icon }) => {
            const selected = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMode(id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  selected
                    ? 'bg-white dark:bg-slate-950 text-primary dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-white'
                }`}
              >
                <Icon className="size-4 text-accent" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode 1: Price Negotiation */}
      {mode === 'negotiation' && (
        <div
          role="tabpanel"
          className="grid gap-6 lg:grid-cols-2 items-center rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-6"
        >
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              Margin-Protected Haggling
            </span>
            <h4 className="text-xl font-bold text-primary dark:text-white">
              Close hesitant buyers without hurting your margins
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Shoppers propose a price on a single item or their entire cart.
              Baci auto-accepts within your safe margin cap, counters
              intelligently, or routes custom offers straight to your Mobile
              Admin app.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { label: 'Offer ₦118,000 (Auto-Accept)', value: 118_000 },
                { label: 'Offer ₦110,000 (Counter-Offer)', value: 110_000 },
              ].map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setOfferAmount(preset.value)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    offerAmount === preset.value
                      ? 'bg-primary text-primary-foreground dark:bg-white dark:text-slate-950 border-primary dark:border-white'
                      : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-accent'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-primary dark:text-white">
                Leather Weekender Bag
              </span>
              <span className="text-muted-foreground">
                List: ₦{LIST_PRICE.toLocaleString()}
              </span>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900 p-4 border border-slate-200/70 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Customer offer</span>
                <span className="font-bold text-primary dark:text-white text-sm">
                  ₦{offerAmount.toLocaleString()}
                </span>
              </div>
              {isAutoAccepted ? (
                <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300 pt-1">
                  <CheckCircle2
                    className="size-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    Within your 2% margin floor—offer auto-accepted and locked
                    in cart!
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5 text-xs pt-1">
                  <p className="text-amber-700 dark:text-amber-300 font-medium">
                    Below floor—Baci sends a margin-safe counter-offer of ₦
                    {counterOffer.toLocaleString()} or routes price-match
                    evidence to Mobile Admin.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mode 2: Discounts & Loyalty */}
      {mode === 'discounts' && (
        <div
          role="tabpanel"
          className="grid gap-6 lg:grid-cols-2 items-center rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-6"
        >
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300">
              Promotions & Retention
            </span>
            <h4 className="text-xl font-bold text-primary dark:text-white">
              Discount codes, promo vouchers &amp; tiered loyalty built in
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Launch percentage or fixed-amount codes with minimum order rules,
              usage limits, and category targeting—paired with Bronze-to-Diamond
              loyalty rewards that turn first-time shoppers into repeat buyers.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {(
                [
                  { code: 'WELCOME10', label: 'Apply WELCOME10 (10% off)' },
                  { code: 'VIP5000', label: 'Apply VIP5000 (₦5,000 off)' },
                ] as const
              ).map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setAppliedCode(code)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    appliedCode === code
                      ? 'bg-primary text-primary-foreground dark:bg-white dark:text-slate-950 border-primary dark:border-white'
                      : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-accent'
                  }`}
                >
                  <Tag className="size-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Cart subtotal</span>
              <span>₦{LIST_PRICE.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-emerald-700 dark:text-emerald-300 font-medium">
              <span>Promo ({appliedCode ?? 'None'})</span>
              <span>-₦{discountAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-primary dark:text-white pt-2 border-t border-slate-200 dark:border-slate-800">
              <span>Checkout total</span>
              <span>₦{finalTotal.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              +120 Loyalty Points earned toward Gold Tier (1.5× multiplier)
            </p>
          </div>
        </div>
      )}

      {/* Mode 3: Mobile Admin Super-App */}
      {mode === 'mobile-admin' && (
        <div
          role="tabpanel"
          className="grid gap-6 lg:grid-cols-2 items-center rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-6"
        >
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300">
              iOS &amp; Android Admin App
            </span>
            <h4 className="text-xl font-bold text-primary dark:text-white">
              Approve offers, recover carts &amp; track profit on the go
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Manage every branch from your pocket: approve live price
              negotiations, follow up on failed checkouts via WhatsApp, scan
              barcodes, log expenses with receipt photos, and export PDF tax
              ledgers.
            </p>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold text-primary dark:text-white">
                  New Offer · ₦112,000
                </p>
                <p className="text-xs text-muted-foreground">
                  Ada O. · Leather Weekender Bag
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNegotiationApproved((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  negotiationApproved
                    ? 'bg-emerald-600 text-white'
                    : 'bg-primary text-primary-foreground dark:bg-white dark:text-slate-950'
                }`}
              >
                {negotiationApproved ? 'Approved ✓' : 'Accept Offer'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold text-primary dark:text-white">
                  Abandoned Transfer · ₦64,500
                </p>
                <p className="text-xs text-muted-foreground">
                  Gateway timeout · 12 mins ago
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <MessageCircle className="size-3.5" aria-hidden="true" />
                <span>WhatsApp</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
