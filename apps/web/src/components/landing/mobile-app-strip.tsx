import {
  ArrowUpRight,
  Handshake,
  MessageCircle,
  Receipt,
  ScanBarcode,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MOBILE_APPS } from '@/config/platform';

const MOBILE_HIGHLIGHTS = [
  {
    icon: Handshake,
    title: 'Real-Time Negotiations',
    description: 'Accept or reject customer offers the moment they arrive.',
  },
  {
    icon: MessageCircle,
    title: 'Abandoned Cart Follow-Up',
    description: 'Reach failed or unpaid checkouts in one tap via WhatsApp.',
  },
  {
    icon: ScanBarcode,
    title: 'Camera Barcode Scanner',
    description: 'Scan QR, EAN, UPC, or Code128 SKUs directly into inventory.',
  },
  {
    icon: Receipt,
    title: 'Expenses & PDF Tax Ledgers',
    description: 'Log receipts, track true profit, and export branded reports.',
  },
] as const;

export function MobileAppStrip() {
  return (
    <section className="py-20 bg-white dark:bg-slate-950 border-y border-slate-200/70 dark:border-slate-800/70">
      <div
        className="container"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <div className="rounded-3xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-8 md:p-12">
          <div className="grid gap-10 lg:grid-cols-12 items-center">
            <div className="lg:col-span-5 space-y-5">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wider">
                <Smartphone className="size-3.5" aria-hidden="true" />
                <span>Baci Mobile Admin</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-primary dark:text-white">
                Run your entire store from your pocket
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Available on iOS and Android. Switch between branches, ship on
                credit, reconcile orders, and stay on top of every sale without
                sitting behind a laptop.
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  asChild
                  size="lg"
                  className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-white dark:text-slate-950"
                >
                  <a
                    href={MOBILE_APPS.admin.appStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Download on App Store</span>
                    <ArrowUpRight className="ml-2 size-4" aria-hidden="true" />
                  </a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="rounded-full border-2"
                >
                  <a
                    href={MOBILE_APPS.admin.playStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Get it on Google Play</span>
                    <ArrowUpRight className="ml-2 size-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>

            <ul className="lg:col-span-7 grid gap-4 sm:grid-cols-2">
              {MOBILE_HIGHLIGHTS.map((item) => (
                <li key={item.title}>
                  <article className="h-full p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
                    <div className="size-10 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
                      <item.icon
                        className="size-5 text-accent"
                        aria-hidden="true"
                      />
                    </div>
                    <h3 className="text-base font-bold text-primary dark:text-white mb-1.5">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
