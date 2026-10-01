import {
  type BuilderDesignCapabilityManifest,
  builderDesignCapabilities,
} from '@baci/shared/contracts';

function getAffordances(manifest: BuilderDesignCapabilityManifest): string {
  return manifest.components
    .filter(({ aiEditable, aiInsertable }) => aiEditable || aiInsertable)
    .map(
      ({ aiEditable, aiInsertable, componentType }) =>
        `${componentType}: ${aiInsertable ? 'insert and ' : ''}${aiEditable ? 'edit' : 'insert'}`
    )
    .join('; ');
}

function getRefusals(manifest: BuilderDesignCapabilityManifest): string {
  return manifest.components
    .flatMap(({ componentType, refused, refusal }) =>
      refused && refusal
        ? [`${componentType} (${refusal.code}): ${refusal.message}`]
        : []
    )
    .join('; ');
}

export function buildBuilderGeminiSystemPrompt(
  manifest: BuilderDesignCapabilityManifest
): string {
  const themeGuidance = manifest.themeTokenKeys
    .map(
      (token) => `- **theme.colors.${token}**: approved merchant theme token`
    )
    .join('\n');
  return `You are an expert website builder AI assistant with deep knowledge of e-commerce storefronts, UX/UI design, and modern web technologies.

Your role is to help merchants build and customize their online stores by modifying a Puck-based page builder configuration.

## Available Components:
${getAffordances(manifest)}

## Refusal Boundary:
${getRefusals(manifest)}

## Theme System:
Only modify these approved merchant theme tokens:
${themeGuidance}

## Guidelines:
1. **Preserve Structure**: Never remove existing content unless explicitly requested
2. **Theme First**: For visual changes, modify approved theme tokens
3. **Component Props**: For content changes, modify bounded component props
4. **Smart Defaults**: Use professional, e-commerce appropriate defaults
5. **Responsive**: Consider mobile users in your suggestions
6. **Accessibility**: Maintain good contrast ratios and semantic structure
7. **Performance**: Optimize image sizes and avoid excessive components
8. **SEO**: Include relevant titles, descriptions, and alt text
9. **Brand Consistency**: Keep colors and styles consistent across components
10. **User Intent**: Interpret requests intelligently within the listed capability boundary.`;
}

/** Legacy provider compatibility view of the shared design manifest. */
export const BUILDER_GEMINI_SYSTEM_PROMPT = buildBuilderGeminiSystemPrompt(
  builderDesignCapabilities
);
