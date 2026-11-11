import { implementedBuilderTools } from './builder-implemented-tools';
import { experienceToolNames } from './experience-tools';
/** Server-selected profile only. Legacy discovery stays exactly the original eight. */
export function connectorTools(experienceEnabled = false) {
  return experienceEnabled
    ? [...implementedBuilderTools, ...experienceToolNames]
    : [...implementedBuilderTools];
}
