import type { ReactNode } from 'react';

/** Editor-free presentation extracted from the production Hero component.
 * Actions are supplied by the adapter; no navigation, animation or cart effects here.
 */
export function HeroPresentation({
  title,
  subtitle,
  align,
  padding,
  backgroundImage,
  backgroundGradient,
  overlay,
  headingLevel = 'h1',
  action,
}: {
  title: string;
  subtitle: string;
  align: 'left' | 'center' | 'right';
  padding: 'small' | 'medium' | 'large';
  backgroundImage?: string;
  backgroundGradient?: string;
  overlay?: boolean;
  headingLevel?: 'h1' | 'h2' | 'div';
  action: ReactNode;
}) {
  const Heading = headingLevel;
  const gradient = Boolean(backgroundGradient && !backgroundImage);
  const shaded = gradient || Boolean(overlay && backgroundImage);
  return (
    <section
      className={`relative baci-hero ${{ small: 'py-12', medium: 'py-24', large: 'py-32' }[padding]}`}
      style={{
        paddingBlock: { small: '3rem', medium: '6rem', large: '8rem' }[padding],
        backgroundImage: backgroundImage
          ? `url(${backgroundImage})`
          : backgroundGradient,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      aria-label="Hero Banner"
    >
      {shaded ? (
        <div
          className={`absolute inset-0 baci-overlay ${gradient ? 'bg-black/60' : 'bg-black/40'}`}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: gradient ? '#0009' : '#0006',
          }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`container px-4 md:px-6 flex flex-col gap-4 relative z-10 baci-container baci-hero-content ${{ left: 'items-start text-left', center: 'items-center text-center', right: 'items-end text-right' }[align]} ${shaded ? 'text-white' : ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          position: 'relative',
          zIndex: 1,
          textAlign: align,
          alignItems: {
            left: 'flex-start',
            center: 'center',
            right: 'flex-end',
          }[align],
          color: shaded ? '#fff' : undefined,
        }}
      >
        <Heading className="text-4xl md:text-6xl font-bold tracking-tighter">
          {title}
        </Heading>
        <p className="text-xl max-w-[700px] opacity-90">{subtitle}</p>
        {action}
      </div>
    </section>
  );
}
