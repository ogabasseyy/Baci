// Reporting for the prebuilt-refs stager: drop warnings (stderr plus
// workflow annotations), the refs manifest, and the step summary. The
// stager calls this after the guardrails pass and before any map is
// rewritten, so a failure here leaves the original maps on disk.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sanitizeRef = (v) => v.replace(/[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069`]/g, '').slice(0, 200);

const isDangling = (s) =>
  s.reason === 'missing' ||
  s.reason === 'non-file' ||
  s.reason === 'escaped-link';

export function writeReport({ stage, staged, skipped, missingCount }) {
  const droppedProtected = skipped.filter((s) => s.reason === 'protected-path').length;
  const droppedInvalid = skipped.filter((s) => s.reason === 'invalid').length;
  if (droppedProtected > 0 || droppedInvalid > 0) {
    const parts = [];
    if (droppedProtected > 0) parts.push(`${droppedProtected} protected-path`);
    if (droppedInvalid > 0) parts.push(`${droppedInvalid} invalid`);
    const total = droppedProtected + droppedInvalid;
    console.error(
      `WARNING: dropped ${parts.join(' and ')} ${total === 1 ? 'entry' : 'entries'} from shipped maps (see .preview-refs-manifest.json)`
    );
    console.error(
      `::warning::Dropped ${parts.join(' and ')} filePathMap ${total === 1 ? 'entry' : 'entries'} from shipped preview maps; serve-verify this preview.`
    );
  }
  if (missingCount > 0) {
    const missingVals = skipped.filter(isDangling).map((s) => sanitizeRef(s.value));
    const shown = missingVals.slice(0, 20);
    console.error(
      `WARNING: dropped ${missingCount} dangling reference(s) from shipped maps:\n` +
        shown.map((v) => `  ${v}`).join('\n') +
        (missingCount > shown.length ? `\n  ...and ${missingCount - shown.length} more` : '') +
        '\nDropped refs can fail at request time: serve-verify this preview (fonts, hero payload), do not trust READY alone.'
    );
    console.error(
      `::warning::Dropped ${missingCount} dangling filePathMap reference(s) from shipped preview maps; serve-verify this preview, do not trust READY alone.`
    );
  }
  staged.sort();
  writeFileSync(
    join(stage, '.preview-refs-manifest.json'),
    `${JSON.stringify({ refs: [...new Set(staged)], skipped }, null, 2)}\n`
  );
  console.log(
    `staged ${new Set(staged).size} referenced file(s), skipped ${skipped.length}`
  );
  // Surface truncation on the build summary: dropped refs are listed in
  // the job output and the manifest, and this makes the counts visible
  // without opening either. Best-effort: the manifest is written and no
  // map is touched yet, so a broken summary path must not fail the build.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const dropped = skipped.filter(isDangling).map((s) => sanitizeRef(s.value));
    const guardedCounts = [];
    if (droppedProtected > 0) guardedCounts.push(`${droppedProtected} protected`);
    if (droppedInvalid > 0) guardedCounts.push(`${droppedInvalid} invalid`);
    const danglingLabel =
      `(${dropped.length} dangling` +
      (guardedCounts.length > 0 ? `, ${guardedCounts.join(', ')}` : '') +
      ')';
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Prebuilt refs\nstaged ${new Set(staged).size}, skipped ${skipped.length} ${danglingLabel}\n` +
          dropped.slice(0, 20).map((v) => `- \`${v}\``).join('\n') +
          (dropped.length > 0 ? '\n' : '') +
          (dropped.length > 0
            ? 'Dropped refs can fail at request time: serve-verify this preview, do not trust READY alone.\n'
            : '')
      );
    } catch (error) {
      console.error(`WARNING: could not write step summary: ${error.message}`);
    }
  }
}
