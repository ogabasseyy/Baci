export function getProductSuggestionRank(
  candidateId: string,
  currentProductId: string
): number {
  const key = `${currentProductId}:${candidateId}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return hash;
}
