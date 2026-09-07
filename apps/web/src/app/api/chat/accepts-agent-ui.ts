import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

export function acceptsAgentUi(request: Request): boolean {
  const accept = request.headers.get('accept');
  if (!accept) return false;

  return accept.split(',').some((value) => {
    const [mediaType, ...parameters] = value.trim().split(';');
    if (
      mediaType?.trim().toLowerCase() !==
      storefrontAgentUiContract.mediaType.toLowerCase()
    ) {
      return false;
    }

    const qualityParameter = parameters.find(
      (parameter) => parameter.split('=', 1)[0]?.trim().toLowerCase() === 'q'
    );
    if (!qualityParameter) return true;

    const quality = Number(qualityParameter.split('=', 2)[1]?.trim());
    return Number.isFinite(quality) && quality > 0 && quality <= 1;
  });
}
