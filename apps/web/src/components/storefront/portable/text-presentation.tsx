/** Text presentation extracted from the production Puck block. */
export function StorefrontTextPresentation({
  title,
  content,
  align,
}: {
  title: string;
  content: string;
  align: 'left' | 'center' | 'right';
}) {
  return (
    <section className="py-12 container px-4 md:px-6 baci-section baci-container">
      <div
        className={`max-w-3xl mx-auto baci-text text-${align}`}
        style={{ textAlign: align }}
      >
        {title ? <h2 className="text-3xl font-bold mb-4">{title}</h2> : null}
        <div className="prose dark:prose-invert max-w-none">
          <p className="text-lg whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </section>
  );
}
