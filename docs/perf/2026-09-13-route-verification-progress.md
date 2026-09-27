# Route verification checkpoint — not a release result

The `header-after-20260914` batch used served build `DBsA1zAhKHtgXqD4M1Lum` and
completed 52 records (6 home samples plus 46 other routes). This is diagnostic
evidence only, not a release result.

## Observed evidence

Real sitespeed.io 42.7.0 video/HAR reports are stored outside git under
`/Users/mac/.codex/cwv-lab-builds/20260912/results/sitespeed/`.
The Chrome HAR identifies 151.0.7922.169 despite a different installed-browser
version in the Docker startup banner. Firefox identifies 154.0.
All runs below use native connectivity, not phone network/CPU throttling.

- `smoke-home-mobile`: one sample, LCP 1.204 s, CLS 0.
- `baseline-blog-mobile`: three samples; LCP 1.212 / 0.348 / 0.708 s,
  no failed HAR requests. These are browser-cold samples, not server-cache resets.
- `baseline-home-firefox`: one sample, LCP about 2.00 s, no failed HAR requests.
- `pre-fallback-home-desktop`: three samples; LCP about 3.08 / 0.796 / 1.09 s.
  Sample 2 contains a main-region layout shift of 0.04318 during header arrival.

The cart browser run proved that `NEXT_PUBLIC_SUPABASE_URL` was absent from the
compiled client bundle even though the runtime environment contained it; the
next rebuild must load the existing public environment before compilation.
The article's earlier POST `text/x-component` 500 was an old proxy-origin
mismatch and is not evidence of a document failure. `/api/events` remains
blocked by missing `SUPABASE_AGENTIC_JWT_PRIVATE_JWK` external configuration.

The desktop filmstrip also shows a short black loading fallback before the
light page. Task edits make that fallback theme-consistent and reserve the
header geometry only while loading, without wrapping the real sticky navbar.
These edits require a new production build and repeat video verification.

## Coverage and unfinished gates

HTTP/HTML preflight examined 26 proposed paths. `/warranty` contains a streamed
404 despite status 200; `/terms-of-service` redirects to `/terms`. Both were
removed from timing averages. The matrix now contains 24 runnable paths.
Empty SSR headings on cart/login still require browser verification.

Remaining: full mobile/desktop matrix, Firefox/WebKit coverage, warm navigation,
console/image validation, comparable before/after Lighthouse samples, final
repository checks, CodeRabbit review, inventory refresh after source commit,
and PR creation. Real iOS/Android measurements are not represented by emulation.

On September 14, space was restored (7.8 GiB at the latest check), above the
5 GiB hard floor. The environment-loaded local compile passed with build ID
`mAqC7HNI7U_zWw54Plynj`; it has not yet been remeasured. Visual or console failures invalidate a run;
metrics alone do not establish a successful route or a production improvement.
