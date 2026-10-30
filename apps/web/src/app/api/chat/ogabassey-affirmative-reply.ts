export function isOgabasseyAffirmativeReply(text: string): boolean {
  return /^(?:yes(?:\s+please)?|yeah|yep|sure|okay|ok|go\s+ahead|please\s+do|do\s+it)[!.?\s]*$/i.test(
    text.trim()
  );
}
