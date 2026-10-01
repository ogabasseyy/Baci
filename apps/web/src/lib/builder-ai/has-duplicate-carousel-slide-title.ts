export function hasDuplicateCarouselSlideTitle(
  slides: unknown[],
  slideIndex: number,
  nextTitle: unknown
): boolean {
  return (
    typeof nextTitle === 'string' &&
    slides.some(
      (slide, candidateIndex) =>
        candidateIndex !== slideIndex &&
        typeof slide === 'object' &&
        slide !== null &&
        !Array.isArray(slide) &&
        (slide as Record<string, unknown>).title === nextTitle
    )
  );
}
