import submitVersionGuardValidator from './validate-fastfile-submit-version-guard.cjs';
import { submitVersionGuardFixtures } from './validate-fastfile-submit-version-guard.fixtures';

const { validateFastfileSubmitVersionGuard } = submitVersionGuardValidator;
const { VALID_FASTFILE, VALID_SLOT } = submitVersionGuardFixtures;

describe('manual App Store submissions must pin the tested build', () => {
  it('rejects a submit lane that permits an unpinned latest build', () => {
    const allowsEmptySelection = VALID_FASTFILE.replace(
      'if build_number.empty? || app_version.empty?',
      'if build_number.empty? ^ app_version.empty?'
    );

    expect(
      validateFastfileSubmitVersionGuard(allowsEmptySelection, VALID_SLOT)
    ).toContain(
      'Fastfile: submit lane must reject an empty build number or app version before slot checks so a concurrent upload cannot change which build is submitted'
    );
  });

  it('rejects an empty-selection guard that does not stop submission', () => {
    const acceptsEmptySelection = VALID_FASTFILE.replace(
      'UI.user_error!("SUBMIT_BUILD_NUMBER and SUBMIT_APP_VERSION are required")',
      'nil'
    );

    expect(
      validateFastfileSubmitVersionGuard(acceptsEmptySelection, VALID_SLOT)
    ).toContain(
      'Fastfile: submit lane must reject an empty build number or app version before slot checks so a concurrent upload cannot change which build is submitted'
    );
  });

  it('rejects a submit lane that reads the selection but does not pass it to deliver', () => {
    const unforwardedSelection = VALID_FASTFILE.replace(
      '  deliver_opts[:build_number] = build_number\n  deliver_opts[:app_version] = app_version\n',
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(unforwardedSelection, VALID_SLOT)
    ).toContain(
      'Fastfile: submit lane must pass the required build_number and app_version values through the options hash passed to deliver'
    );
  });
});
