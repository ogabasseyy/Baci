import { buildRemediationCodexCommand } from './remediation-codex-command.mjs';
import { redactCodexOutput } from './remediation-codex-output.mjs';
import {
  appendValidatedResearch,
  buildCodexRemediationPrompt,
  buildCodexResearchPrompt,
  MAX_VALIDATED_RESEARCH_CHARS,
} from './remediation-policy.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';

const REQUIRED_HEADINGS = [
  'RESEARCH_SUMMARY',
  'ROOT_CAUSE_CONFIDENCE',
  'OPTIONS_CONSIDERED',
  'SELECTED_FIX',
  'VALIDATION_PLAN',
];
const MIN_SECTION_LENGTHS = {
  OPTIONS_CONSIDERED: 12,
  RESEARCH_SUMMARY: 20,
  SELECTED_FIX: 12,
  VALIDATION_PLAN: 12,
};

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) =>
      typeof item === 'string'
        ? item
        : typeof item?.text === 'string'
          ? item.text
          : ''
    )
    .filter(Boolean)
    .join('\n');
}

function extractEventText(event) {
  if (
    event?.type !== 'item.completed' ||
    event.item?.type !== 'agent_message'
  ) {
    return '';
  }
  return [
    event?.item?.text,
    textFromContent(event?.item?.content),
    event?.text,
    event?.response?.output_text,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

export function extractCodexResearchText(stdout) {
  return String(stdout || '')
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [extractEventText(JSON.parse(line))];
      } catch {
        return [];
      }
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function sectionFor(text, heading) {
  const lines = text.split(/\r?\n/);
  const headingPattern = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?${heading}\\b\\s*:?\\s*(.*)$`,
    'i'
  );
  const nextHeading = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:${REQUIRED_HEADINGS.join('|')})\\b`,
    'i'
  );
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return '';
  const first = lines[start].match(headingPattern)?.[1] || '';
  const rest = [];
  for (const line of lines.slice(start + 1)) {
    if (nextHeading.test(line)) break;
    rest.push(line);
  }
  return [first, ...rest].join('\n').trim();
}

function exactConfidenceValue(value) {
  const normalized = String(value || '').trim();
  const formatted = normalized.match(/^(\*\*|__|`)(high|medium|low)\1$/i);
  return (formatted ? formatted[2] : normalized).toLowerCase();
}

export function validateCodexResearchResult(stdout) {
  const extracted = extractCodexResearchText(stdout);
  const text = redactCodexOutput(extracted)
    .slice(0, MAX_VALIDATED_RESEARCH_CHARS)
    .replaceAll('<', '\\u003c')
    .trim();
  const sections = Object.fromEntries(
    REQUIRED_HEADINGS.map((heading) => [heading, sectionFor(text, heading)])
  );
  const reasons = REQUIRED_HEADINGS.filter((heading) => !sections[heading]).map(
    (heading) => `research heading missing or empty: ${heading}`
  );
  for (const [heading, minimum] of Object.entries(MIN_SECTION_LENGTHS)) {
    if (sections[heading] && sections[heading].length < minimum) {
      reasons.push(
        `research heading is too short to be defensible: ${heading}`
      );
    }
  }
  if (
    sections.ROOT_CAUSE_CONFIDENCE &&
    !['high', 'medium', 'low'].includes(
      exactConfidenceValue(sections.ROOT_CAUSE_CONFIDENCE)
    )
  ) {
    reasons.push('root-cause confidence must be high, medium, or low');
  }
  const optionLines = (sections.OPTIONS_CONSIDERED || '')
    .split(/\r?\n/)
    .filter((line) =>
      [
        /^\s*(?:[-*]|\d+[.)])\s+\S+/,
        /^\s*(?:#{1,6}\s*)?Option\s+[A-Z0-9]+\s*(?::|[.)-])\s*\S+/i,
        /^\s*(?:#{1,6}\s*)?Option\s+[A-Z0-9]+\s*$/i,
      ].some((pattern) => pattern.test(line))
    );
  if (sections.OPTIONS_CONSIDERED && optionLines.length < 2) {
    reasons.push('research must compare at least two plausible options');
  }
  if (
    sections.SELECTED_FIX &&
    /\b(?:no\s+(?:a\s+)?defensible(?!(?:\s+\w+){0,4}\s+reason\s+(?:to\s+)?reject\b)(?:\s+\w+){0,4}\s+fix|no\s+(?:safe\s+)?(?:code\s+)?(?:change|fix|changes|fixes)\s+(?:can|could)\s+be\s+(?:safely\s+)?(?:established|identified|justified|determined|found)(?![^.;]*,\s*so\s+(?:\w+\s+){0,2}(?:apply|use|implement|adopt|proceed|switch|fall back)\b)|(?:a\s+)?defensible\s+fix\s+(?:cannot|can't|can not)\s+(?:be\s+)?(?:established|identified|justified|determined|found)|^(?:(?:I|we)\s+)?(?:cannot|can't|can not|could not|couldn't)\s+(?:establish|identify|determine|justify|find|propose|recommend|confirm|verify|select|guarantee)\s+(?:(?:a|the)\s+)?(?:safe|defensible)(?:\s+\w+){0,4}\s+fix(?![^.;]*,\s*so\s+(?:\w+\s+){0,2}(?:apply|use|implement|adopt|proceed|switch|fall back)\b)|(?:fix(?:es)?|change(?:s)?)(?:\s+\w+){0,4}\s+(?:is|are|was|were|has|have)\s+(?:not\s+(?:\w+\s+){0,2}(?:be(?:en)?\s+)?(?:identified|established|justified|determined|found)|unavailable(?![^.;]*,\s*so\s+(?:\w+\s+){0,2}(?:apply|use|implement|adopt|proceed|switch|fall back)\b))|^none|^(?:(?:I(?:'m| am| was)?|we(?:'re| are| were)?)\s+)?unable to|(?:requir(?:ed|es)|need(?:ed|s))\s+before\s+(?:a\s+)?(?:safe\s+|defensible\s+)?(?:fix(?:es)?|change(?:s)?)\s+can\s+be\s+(?:selected|established|identified|justified|determined)(?![^.;]*,\s*so\s+(?:\w+\s+){0,2}(?:apply|use|implement|adopt|proceed|switch|fall back)\b)|cannot safely\s+(?:(?:be\s+)?(?:established|identified|justified|determined|selected|proposed|recommended|confirmed|verified|guaranteed)|(?:establish|identify|determine|justify|select|propose|recommend|confirm|verify|find|guarantee)\s+(?:(?:a|the|any)\s+)?(?:safe\s+|defensible\s+)?(?:fix(?:es)?|change(?:s)?))(?![^.;]*,\s*so\s+(?:\w+\s+){0,2}(?:apply|use|implement|adopt|proceed|switch|fall back)\b))\b/i.test(
      sections.SELECTED_FIX
    )
  ) {
    reasons.push('research did not establish a defensible selected fix');
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    sections,
    text,
  };
}

export function runRemediationCodexPhase({
  codexBin,
  commandEnv,
  containerIdentity,
  prompt,
  readOnly,
  repoDir,
  runner,
  runCodex,
  timeout,
  worktreeCommandOptions,
  worktreeDir,
}) {
  const command = buildRemediationCodexCommand({
    codexBin,
    containerIdentity,
    env: commandEnv,
    prompt,
    readOnly,
    repoDir,
    worktreeDir,
    enableSearch: true,
  });
  try {
    return runCodex(command.command, command.args, {
      ...worktreeCommandOptions,
      timeout,
    });
  } finally {
    if (command.cleanup) {
      runner(command.cleanup.command, command.cleanup.args, {
        cwd: worktreeDir,
        env: worktreeCommandOptions.env,
        shell: false,
      });
    }
  }
}

export function runRemediationCodexPhases({
  candidate,
  commandEnv,
  codexBin,
  containerIdentity,
  prompt,
  repoDir,
  runner,
  runCodex,
  worktreeCommandOptions,
  worktreeDir,
}) {
  const timeout = readPositiveInt(
    commandEnv.BACI_CODEX_TIMEOUT_MS,
    6 * 60 * 1000
  );
  const researchExecution = runRemediationCodexPhase({
    codexBin,
    commandEnv,
    containerIdentity,
    prompt: buildCodexResearchPrompt({ candidate }),
    readOnly: true,
    repoDir,
    runner,
    runCodex,
    timeout,
    worktreeCommandOptions,
    worktreeDir,
  });
  const research = validateCodexResearchResult(researchExecution.stdout);
  if (!research.accepted) return { research, researchExecution };
  const implementationPrompt = appendValidatedResearch(
    prompt || buildCodexRemediationPrompt({ candidate }),
    research.text
  );
  return {
    implementationExecution: runRemediationCodexPhase({
      codexBin,
      commandEnv,
      containerIdentity,
      prompt: implementationPrompt,
      readOnly: false,
      repoDir,
      runner,
      runCodex,
      timeout,
      worktreeCommandOptions,
      worktreeDir,
    }),
    research,
    researchExecution,
  };
}
