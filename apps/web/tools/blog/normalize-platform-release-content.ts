/** Preserve generated image/caption content in the editor's supported HTML shape. */
export function normalizePlatformReleaseContent(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const figure of document.querySelectorAll('figure')) {
    const image = figure.querySelector(':scope > img');
    const caption = figure.querySelector(':scope > figcaption');
    const unexpectedAttributes = [...figure.attributes].some(
      ({ name, value }) => name !== 'class' || value !== 'blog-inline-image'
    );
    const unexpectedChildren = [...figure.childNodes].some((node) =>
      node.nodeType === 3
        ? Boolean(node.textContent?.trim())
        : node !== image && node !== caption
    );
    if (
      !image ||
      unexpectedAttributes ||
      unexpectedChildren ||
      (caption &&
        (caption.attributes.length > 0 || caption.querySelector('figure, img')))
    ) {
      throw new Error('Unsupported generated figure structure');
    }
    const imageParagraph = document.createElement('p');
    imageParagraph.append(image);
    const captionParagraph = document.createElement('p');
    if (caption) {
      while (caption.firstChild) captionParagraph.append(caption.firstChild);
    }
    figure.replaceWith(imageParagraph, ...(caption ? [captionParagraph] : []));
  }
  return document.body.innerHTML;
}
