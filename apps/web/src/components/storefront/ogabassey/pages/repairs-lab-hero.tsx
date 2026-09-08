import { Sparkles, Wrench } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface RepairsLabHeroProps {
  repairHref?: string;
  swapHref?: string;
}

function ActionSlot({ href, label, className }: {
  href?: string;
  label: string;
  className: string;
}) {
  return href ? (
    <Link href={asRoute(href)} className={className}>{label}</Link>
  ) : (
    <span aria-hidden="true" className={`${className} invisible`}>{label}</span>
  );
}

export function RepairsLabHero({ repairHref, swapHref }: RepairsLabHeroProps) {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <div className="bg-store-primary/10 p-2 rounded-lg text-store-primary">
          <Wrench size={24} />
        </div>
        <h1 className="text-2xl font-bold text-store-background-text">
          Repair Lab
        </h1>
      </div>
      <p className="text-store-background-text/55 text-sm mb-8 max-w-xl">
        Extend the life of your devices. Expert repairs that save you money
        and help the planet.
      </p>

      <div className="bg-store-background-text text-store-background rounded-3xl p-8 md:p-12 mb-12 relative overflow-hidden shadow-xl">
        <div className="relative z-10 max-w-lg">
          <span className="inline-flex items-center gap-1.5 bg-store-primary/20 backdrop-blur-md border border-store-primary/30 text-store-primary text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-wider">
            <Sparkles size={12} /> Premium Service
          </span>
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4 leading-tight">
            Don't Ditch It. <br />
            <span className="text-store-primary">Fix It.</span>
          </h2>
          <p className="text-store-background/70 mb-8 text-sm md:text-base leading-relaxed">
            Every device repaired is one less in a landfill. Our certified
            technicians use genuine parts to give your gadget a second life.
          </p>
            <div className="flex flex-wrap gap-4">
                <ActionSlot
                  href={repairHref}
                  label="Book a Repair"
                  className="bg-store-primary text-store-primary-text font-bold py-3.5 px-8 rounded-xl hover:bg-store-primary/90 transition-colors shadow-lg active:scale-95 shadow-store-primary/20"
                />
                <ActionSlot
                  href={swapHref}
                  label="Trade-in Instead"
                  className="bg-store-background/10 text-store-background border border-store-background/20 font-bold py-3.5 px-8 rounded-xl hover:bg-store-background/20 transition-colors active:scale-95 backdrop-blur-xs"
                />
            </div>
        </div>

        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_1px_1px,var(--store-background)_1px,transparent_0)] bg-[length:18px_18px]" />
        <div className="absolute -right-20 -bottom-20 size-96 bg-store-primary rounded-full blur-[120px] opacity-20" />
      </div>
    </>
  );
}
