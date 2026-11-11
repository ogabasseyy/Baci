const BOT_PATTERN =
  /bot\b|crawler|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|datadog|facebookexternalhit|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client|okhttp\/.*bot/i;

/** Obvious crawlers and monitors; ordinary browsers never match. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && BOT_PATTERN.test(userAgent));
}
