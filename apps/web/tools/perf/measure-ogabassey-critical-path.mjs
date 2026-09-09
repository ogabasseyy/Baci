#!/usr/bin/env node
process.env.OGABASSEY_CWV_TARGET_LABELS = 'home,pdp-lcp';
process.env.OGABASSEY_CWV_SKIP_LATEST_BLOG_POST = '1';
process.env.OGABASSEY_CWV_STRATEGIES = 'mobile';
process.env.OGABASSEY_CWV_USE_PDP_LCP_URL = '0';
process.env.OGABASSEY_CWV_USE_DEBUGBEAR_RAW_DIR = '0';
const { runOgaBasseyCwv } = await import('./measure-ogabassey-cwv.mjs');
await runOgaBasseyCwv();
