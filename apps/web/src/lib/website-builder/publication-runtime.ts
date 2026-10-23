import type { OwnerPublicationDependencies } from './owner-publication-handler';
import { createOwnerPublicationHandler } from './owner-publication-handler';

let installed: ReturnType<typeof createOwnerPublicationHandler> | undefined;
/** Private release bootstrap supplies owner auth, independent proof writer and bounded delivery verifier. */
export function installOwnerPublicationRuntime(
  deps: OwnerPublicationDependencies
) {
  if (installed) throw Error('Publication runtime already installed');
  const handler = createOwnerPublicationHandler(deps);
  installed = handler;
  return () => {
    if (installed === handler) installed = undefined;
  };
}
export function getOwnerPublicationRuntime() {
  return installed;
}
