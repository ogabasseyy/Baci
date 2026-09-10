export function loadStylesheetAfterWindowLoad(
  load: () => Promise<unknown>,
  errorMessage: string
): () => void {
  const run = () => {
    load().catch((error: unknown) => {
      console.error(new Error(errorMessage, { cause: error }));
    });
  };

  if (document.readyState === 'complete') {
    run();
    return () => undefined;
  }

  window.addEventListener('load', run);
  return () => window.removeEventListener('load', run);
}
