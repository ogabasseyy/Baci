import { AnimatedWrapper } from '@/components/builder/animated-wrapper';
import type { PreviewInertHeroProps } from './preview-inert-hero';

type PreviewInertFaqProps = Pick<
  PreviewInertHeroProps,
  'animationDelay' | 'animationDuration' | 'animationTrigger' | 'animationType'
> & {
  items?: { answer?: string; question?: string }[];
  style?: 'accordion' | 'grid' | 'list';
  subtitle?: string;
  title?: string;
};

export function PreviewInertFAQ({
  animationDelay = 0,
  animationDuration = 'normal',
  animationTrigger = 'scroll',
  animationType = 'none',
  items = [],
  style = 'accordion',
  subtitle,
  title,
}: PreviewInertFaqProps) {
  return (
    <AnimatedWrapper
      animation={{
        delay: animationDelay,
        duration: animationDuration,
        trigger: animationTrigger === 'onload' ? 'immediate' : animationTrigger,
        type: animationType,
      }}
    >
      <section
        aria-label="Preview FAQ"
        className="py-12 md:py-16 container px-4 md:px-6"
        data-animation-delay={animationDelay}
        data-animation-duration={animationDuration}
        data-animation-trigger={animationTrigger}
        data-animation-type={animationType}
      >
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="text-3xl font-bold mb-4">{title}</h2>
          {subtitle ? (
            <p className="text-muted-foreground text-lg">{subtitle}</p>
          ) : null}
        </div>
        {style === 'accordion' ? (
          <div className="max-w-2xl mx-auto space-y-3" data-style={style}>
            {items.map((item) => (
              <details
                className="group border rounded-lg"
                key={`${item.question ?? ''}:${item.answer ?? ''}`}
                open
              >
                <summary className="flex justify-between items-center cursor-pointer p-4 font-medium hover:bg-muted/50 transition-colors">
                  {item.question}
                  <span className="ml-2 transform group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                {item.answer ? (
                  <div className="p-4 pt-0 text-muted-foreground">
                    {item.answer}
                  </div>
                ) : null}
              </details>
            ))}
          </div>
        ) : null}
        {style === 'grid' ? (
          <div
            className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto"
            data-style={style}
          >
            {items.map((item) => (
              <article
                className="p-6 border rounded-lg bg-card"
                key={`${item.question ?? ''}:${item.answer ?? ''}`}
              >
                <h3 className="font-semibold text-lg mb-2">{item.question}</h3>
                {item.answer ? (
                  <p className="text-muted-foreground">{item.answer}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        {style === 'list' ? (
          <div className="max-w-2xl mx-auto space-y-6" data-style={style}>
            {items.map((item) => (
              <article
                className="border-b pb-6 last:border-0"
                key={`${item.question ?? ''}:${item.answer ?? ''}`}
              >
                <h3 className="font-semibold text-lg mb-2">{item.question}</h3>
                {item.answer ? (
                  <p className="text-muted-foreground">{item.answer}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </AnimatedWrapper>
  );
}
