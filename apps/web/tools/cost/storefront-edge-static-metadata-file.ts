const STATIC_METADATA_FILE_PATTERN =
  /^(?:favicon\.ico|icon\d*\.(?:ico|jpg|jpeg|png|svg)|apple-icon\d*\.(?:jpg|jpeg|png)|opengraph-image\d*\.(?:jpg|jpeg|png|gif)|twitter-image\d*\.(?:jpg|jpeg|png|gif)|robots\.txt|sitemap\.xml|manifest\.json)$/;

/** Matches Next static metadata file conventions without accepting arbitrary assets. */
export function isStorefrontStaticMetadataFile(fileName: string): boolean {
  return STATIC_METADATA_FILE_PATTERN.test(fileName);
}
