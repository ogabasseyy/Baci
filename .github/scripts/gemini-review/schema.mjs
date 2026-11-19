// The review the model must return (sent as the response JSON schema) and the severities.
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Findings at these severities set the `Gemini review` status to failure. */
export const BLOCKING_SEVERITIES = ['critical', 'high'];

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'One or two sentences: the overall assessment.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          title: { type: 'string', description: 'Short summary of the problem.' },
          path: { type: 'string', description: 'A file path from the changed-file list.' },
          line: { type: 'integer', description: 'Line in the new version of the file, 0 if file-wide.' },
          body: { type: 'string', description: 'Why it is a problem, quoting the relevant line.' },
        },
        required: ['severity', 'title', 'path', 'line', 'body'],
      },
    },
    next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'findings', 'next_steps'],
};
