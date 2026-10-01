import type { BuilderData } from '@baci/shared/contracts';

export function cloneBuilderAiConfig(
  config: BuilderData,
  createError: new (message: string) => Error
): BuilderData {
  try {
    return JSON.parse(JSON.stringify(config)) as BuilderData;
  } catch {
    throw new createError('Builder configuration cannot be cloned');
  }
}
