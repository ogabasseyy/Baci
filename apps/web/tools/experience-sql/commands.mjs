/** Fixed local qualification commands, never an arbitrary shell/job runner. */
export function experienceSqlCommands(requested = []) {
  if (
    requested.some(
      (v) =>
        !['private-foundation', 'uploads', 'jobs', 'publication'].includes(v)
    )
  )
    throw Error('Unknown local SQL suite');
  const selected = requested.length
    ? [
        ...new Set(
          requested.flatMap((name) =>
            name === 'publication'
              ? ['jobs', 'draft-approval']
              : [name === 'uploads' ? 'upload' : name]
          )
        ),
      ]
    : ['private-foundation', 'upload', 'jobs', 'fixture', 'draft-approval'];
  return [
    [
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        ...(requested.length
          ? [
              '--test-name-pattern',
              [
                ...new Set([
                  ...requested,
                  ...(requested.includes('publication') ? ['jobs'] : []),
                ]),
              ].join('|'),
            ]
          : []),
        ...selected.map((n) => `tools/experience-sql/${n}.node.test.ts`),
      ],
    ],
    ...(!requested.length || requested.includes('uploads')
      ? [
          [
            'pnpm',
            [
              '--config.verify-deps-before-run=false',
              'exec',
              'vitest',
              'run',
              '--config',
              'vitest.experience-storage.config.ts',
            ],
          ],
        ]
      : []),
  ];
}
export function privateQualificationCommands() {
  return [
    [process.execPath, ['tools/experience-sql/run.mjs']],
    [process.execPath, ['experience-runtime/build.mjs']],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.experience-authoring.config.ts',
      ],
    ],
    [
      'pnpm',
      [
        '--config.verify-deps-before-run=false',
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/experience-browser/playwright.config.ts',
      ],
    ],
  ];
}
