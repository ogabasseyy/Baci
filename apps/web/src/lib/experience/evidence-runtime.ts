import type { createExperienceEvidenceReader } from './evidence-read';

type Reader = ReturnType<typeof createExperienceEvidenceReader>;
let installed: Reader | undefined;
/** No default installation; Node composition must provide authenticated dependencies. */
export function installExperienceEvidenceReader(reader: Reader) {
  if (installed) throw Error('Experience evidence already installed');
  installed = reader;
  return () => {
    if (installed === reader) installed = undefined;
  };
}
export function getExperienceEvidenceReader() {
  return installed;
}
