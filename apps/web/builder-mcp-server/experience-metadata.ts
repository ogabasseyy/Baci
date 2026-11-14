import type { ExperienceToolName } from '../src/schemas/experience-tools';
export const experienceToolDescriptions: Record<
  ExperienceToolName,
  { title: string; description: string }
> = {
  get_experience_capabilities: {
    title: 'Read full-code capabilities',
    description:
      'Read owner-only full React/TypeScript/CSS authoring capabilities. For accessible product add and checkout buttons, add data-baci-commerce="add" and data-baci-commerce="checkout" respectively so verification can find them regardless of their visible language; these attributes do not replace Baci commerce calls. The fixed local Chromium qualification policy measures host and frame LCP at 390px and 1440px, with a 2s median target for one representative of every declared route family and CLS <= 0.1 on every sample. This local gate does not establish field Core Web Vitals, production performance, or release authorization. Reserve image dimensions, prioritize the real hero and avoid blocking initial content on scripts or fonts. Use read_experience_performance for exact-build diagnostics; not-measured, partial, or contaminated results do not pass publication qualification. Follow runtimeRendering from capabilities: prerender-private enables local private prerender previews; client keeps the legacy path. Baci inference is never invoked.',
  },
  read_experience: {
    title: 'Read, patch or adopt uploaded source',
    description:
      'Read bounded source pages, submit an exact-version patch, or adopt a completed chunk upload by artifact ID and base/version. Changes affect private source only; they do not apply a build, publish, or invoke AI. Use adopt-upload for large files to preserve bounded MCP requests.',
  },
  begin_experience_upload: {
    title: 'Begin bounded source upload',
    description:
      'Begin an owner-only upload with manifest and file descriptors. Send source through bounded chunks.',
  },
  write_experience_chunk: {
    title: 'Write source chunk',
    description:
      'Write one base64-encoded chunk up to 32768 decoded bytes with its SHA-256 digest. Exact repeats reconcile.',
  },
  finalize_experience_upload: {
    title: 'Finalize source upload',
    description:
      'Validate uploaded paths, digests and quotas into an immutable private artifact.',
  },
  build_experience: {
    title: 'Queue offline build',
    description:
      'Queue a bounded offline sandbox build of the exact private artifact; no AI provider is called.',
  },
  read_experience_performance: {
    title: 'Read exact-build performance evidence',
    description:
      'Read retained local synthetic browser diagnostics for an owner-authorized build. Does not run a browser, accept URLs or reports, call AI, or publish. Missing results return not-measured; incomplete or contaminated results remain visible but fail the local qualification summary. Frame and host metrics are separate; interaction duration is not field INP. A passed local qualification is not field CWV or production release evidence.',
  },
  get_experience_operation: {
    title: 'Read build operation',
    description:
      'Read owner-bound operation status without creating a job or running a provider. An expired status means the unfinished job can no longer complete; create a new build job for the artifact with a new idempotency key.',
  },
  finalize_experience_build: {
    title: 'Qualify and finalize build',
    description:
      'Run the queued immutable source through the selected isolated runtime and independent verification. With background processing enabled, this reads the job status and it may still be queued; report a completed build only after its status confirms completion. Finalization retains a private candidate and never applies or publishes it. If the response times out or disconnects, do not assume failure or start another build: use get_experience_operation with the same jobId to inspect its status before deciding what to do.',
  },
  preview_experience: {
    title: 'Capture private experience preview',
    description:
      'Create bounded independent visual evidence and an authenticated owner preview link for the exact build. This is a mutation; shopping is simulated.',
  },
  apply_experience: {
    title: 'Request private apply approval',
    description:
      'Create an exact-build private apply intent. Only the signed-in owner web confirmation can advance the private draft. Never pass approval booleans.',
  },
  publish_experience: {
    title: 'Request publication approval',
    description:
      'Request a separate exact-version publication intent. This tool never confirms publication; the owner must review in Baci. Candidate qualification is not release authorization.',
  },
  rollback_experience: {
    title: 'Request compatible rollback approval',
    description:
      'Request a new owner-confirmed intent for a retained compatible build. Does not reverse source, orders or payments and never confirms the pointer swap.',
  },
  read_experience_evidence: {
    title: 'Read native preview image',
    description:
      'Read one owner/grant-bound pre-generated PNG/JPEG as native image content, at most 2 MiB. Does not create a capture job or accept an arbitrary URL.',
  },
};
