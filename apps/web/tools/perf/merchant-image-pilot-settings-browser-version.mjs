// Attested browser build version validator for the pilot effective-settings gate.
export function verifyBrowserVersion(version, expectMajor) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    return {
      error: `attested version "${version}" is not a dotted browser build`,
      ok: false,
    };
  }
  if (!version.startsWith(`${expectMajor}.`)) {
    return {
      error: `attested executable ${version} does not match Chrome ${expectMajor}`,
      ok: false,
    };
  }
  return { ok: true };
}
