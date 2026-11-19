const BOT_PATTERN =
  /\bbot\b|\+https?:|googlebot|adsbot|mediapartners-google|google-inspectiontool|bingbot|yandexbot|duckduckbot|applebot|semrushbot|ahrefsbot|petalbot|bytespider|gptbot|claudebot|ccbot|twitterbot|linkedinbot|pinterestbot|discordbot|slackbot|telegrambot|mj12bot|dotbot|crawler|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|datadog|facebookexternalhit|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client/i;

/** Obvious crawlers and monitors; ordinary browsers and device names never match. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && BOT_PATTERN.test(userAgent));
}
