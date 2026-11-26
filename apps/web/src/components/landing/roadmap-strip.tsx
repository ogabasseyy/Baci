import { Sparkles } from 'lucide-react';
import { FeatureIcon } from '@/components/landing/feature-icon';
import { PLATFORM_ROADMAP_FEATURES } from '@/config/platform-features';

export function RoadmapStrip() {
  return (
    <section
      id="roadmap"
      className="py-20 bg-slate-50/70 dark:bg-slate-900/40 border-y border-slate-200/70 dark:border-slate-800/70"
    >
      <div
        className="container"
        style={{
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
        }}
      >
        <div className="max-w-3xl mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>On the Roadmap · Coming Soon</span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-primary dark:text-white mb-3">
            What we&apos;re building next
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            Baci ships fast. Here are the next major commerce capabilities
            currently in active development and planning.
          </p>
        </div>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_ROADMAP_FEATURES.map((item) => (
            <li key={item.id}>
              <article className="h-full p-6 rounded-2xl bg-white dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700/80 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="size-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                      <FeatureIcon
                        name={item.icon}
                        className="size-5 text-accent"
                      />
                    </div>
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      {item.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-primary dark:text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
