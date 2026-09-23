import { Sparkles, Wrench } from 'lucide-react';
import { RepairsLabHeroActionSlot } from './repairs-lab-hero-action-slot';

interface RepairsLabHeroProps {
  repairHref?: string;
  swapHref?: string;
}

export function RepairsLabHero({ repairHref, swapHref }: RepairsLabHeroProps) {
  return (
    <>
      <div data-cwv-lcp-fold="">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-lg bg-store-primary/10 p-2 text-store-primary">
            <Wrench size={24} />
          </div>
          <h1 className="text-2xl font-bold text-store-background-text">
            Repair Lab
          </h1>
        </div>

        <div className="relative mb-8 overflow-hidden rounded-3xl bg-store-background-text p-8 text-store-background shadow-xl md:p-12">
          <div className="relative z-10 max-w-lg">
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-store-primary/30 bg-store-primary/20 px-3 py-1 font-bold text-store-primary text-xs uppercase tracking-wider backdrop-blur-md">
              <Sparkles size={12} /> Premium Service
            </span>
            <h2
              className="mb-4 font-extrabold text-3xl leading-tight md:text-5xl"
              data-cwv-lcp-copy="repairs"
            >
              Don't Ditch It. <br />
              <span className="text-store-primary">Fix It.</span>
            </h2>
            <p
              className="mb-6 text-sm text-store-background/80"
              data-cwv-lcp-support=""
            >
              Every device repaired is one less in a landfill.
            </p>
            <div className="flex flex-wrap gap-4">
              <RepairsLabHeroActionSlot
                href={repairHref}
                label="Book a Repair"
                className="rounded-xl bg-store-primary px-8 py-3.5 font-bold text-store-primary-text shadow-lg shadow-store-primary/20 transition-colors hover:bg-store-primary/90 active:scale-95"
              />
              <RepairsLabHeroActionSlot
                href={swapHref}
                label="Trade-in Instead"
                className="rounded-xl border border-store-background/20 bg-store-background/10 px-8 py-3.5 font-bold text-store-background backdrop-blur-xs transition-colors hover:bg-store-background/20 active:scale-95"
              />
            </div>
          </div>

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--store-background)_1px,transparent_0)] bg-[length:18px_18px] opacity-10" />
          <div className="absolute -right-20 -bottom-20 size-96 rounded-full bg-store-primary opacity-20 blur-[120px]" />
        </div>
      </div>
      <div className="mb-12 max-w-lg space-y-3 text-sm leading-6 text-store-background-text/70">
        <p>
          Extend the life of your devices. Expert repairs that save you money
          and help the planet.
        </p>
        <p>
          Our certified technicians use genuine parts to give your gadget a
          second life.
        </p>
      </div>
    </>
  );
}
