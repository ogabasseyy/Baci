import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import submitVersionGuardValidator from './validate-fastfile-submit-version-guard.cjs';

const { validateFastfileSubmitVersionGuard } = submitVersionGuardValidator;

const VALID_SLOT = `def review_cancellation_allowed?
  %w[1 true yes].include?(ENV["IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT"].to_s.strip.downcase)
end

def ensure_replacement_build_exists!(app, platform, app_version:, build_number:)
  build = Spaceship::ConnectAPI::Build.all(
    app_id: app.id,
    version: requested_version,
    build_number: requested_build,
    platform: platform,
    processing_states: SUBMITTABLE_BUILD_PROCESSING_STATE
  ).reject(&:expired).first

  return build if build

  UI.user_error!("no replacement build")
end

def wait_for_editable_app_store_version(app, platform)
  EDITABLE_VERSION_POLL_ATTEMPTS.times do
    version = app.get_edit_app_store_version(platform: platform)
    return version if version

    sleep(EDITABLE_VERSION_POLL_INTERVAL_SECONDS)
  end

  nil
end

def app_store_version_slot_ready?(app_version:, build_number:)
  app = Spaceship::ConnectAPI::App.find(BUNDLE_ID)
  platform = Spaceship::ConnectAPI::Platform::IOS
  return true if app.get_edit_app_store_version(platform: platform)

  submission = app.get_in_progress_review_submission(platform: platform)
  return false if submission.nil?

  unless review_cancellation_allowed?
    return false
  end

  ensure_replacement_build_exists!(
    app,
    platform,
    app_version: app_version,
    build_number: build_number
  )

  submission.cancel_submission

  return true if wait_for_editable_app_store_version(app, platform)

  UI.user_error!("cancelled but no editable version appeared")
end`;

const VALID_FASTFILE = `import("asc_version_slot.rb")

lane :submit do
  api_key = asc_api_key
  deliver_opts = {
    submit_for_review: true
  }

  unless app_store_version_slot_ready?(app_version: app_version, build_number: build_number)
    next
  end

  set_changelog(changelog_opts)
  update_app_review_notes!(review_notes_text, app_version: app_version)
  deliver(deliver_opts)
end`;

const readFastlaneFile = (name: string) =>
  readFileSync(join(__dirname, '..', 'fastlane', name), 'utf8');

describe('validateFastfileSubmitVersionGuard', () => {
  it('accepts a submit lane that frees the version slot before set_changelog', () => {
    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, VALID_SLOT)).toEqual([]);
  });

  it('accepts the real storefront Fastfile and version-slot helper', () => {
    const fastfile = readFastlaneFile('Fastfile');
    const versionSlot = readFastlaneFile('asc_version_slot.rb');

    expect(validateFastfileSubmitVersionGuard(fastfile, versionSlot)).toEqual([]);
  });
});

describe('bugfix: submit lane died creating an App Store version Apple refuses to create', () => {
  it('rejects a lane that calls set_changelog without freeing the version slot', () => {
    const withoutGuard = VALID_FASTFILE.replace(
      /  unless app_store_version_slot_ready\?\(app_version: app_version, build_number: build_number\)\n    next\n  end\n\n/,
      ''
    );

    expect(validateFastfileSubmitVersionGuard(withoutGuard, VALID_SLOT)).toContain(
      'Fastfile: submit lane must call app_store_version_slot_ready? before set_changelog'
    );
  });

  it('rejects a lane that frees the slot only after set_changelog already ran', () => {
    const guardTooLate = `import("asc_version_slot.rb")

lane :submit do
  set_changelog(changelog_opts)

  unless app_store_version_slot_ready?(app_version: app_version, build_number: build_number)
    next
  end

  deliver(deliver_opts)
end`;

    expect(validateFastfileSubmitVersionGuard(guardTooLate, VALID_SLOT)).toContain(
      'Fastfile: app_store_version_slot_ready? must run BEFORE set_changelog, not after'
    );
  });

  it('rejects a Fastfile that never imports the extracted version-slot helper', () => {
    const withoutImport = VALID_FASTFILE.replace('import("asc_version_slot.rb")\n\n', '');

    expect(validateFastfileSubmitVersionGuard(withoutImport, VALID_SLOT)).toContain(
      'Fastfile: must import asc_version_slot.rb, otherwise the version-slot helpers are undefined'
    );
  });

  it('rejects withdrawing a build from review without the explicit opt-in', () => {
    const ungatedCancellation = VALID_SLOT.replace(
      /  unless review_cancellation_allowed\?\n    return false\n  end\n\n/,
      ''
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, ungatedCancellation)).toContain(
      'asc_version_slot.rb: cancel_submission must be guarded by review_cancellation_allowed?'
    );
  });

  it('rejects a gate that is present but runs after the cancellation', () => {
    const gateTooLate = VALID_SLOT.replace(
      `  unless review_cancellation_allowed?
    return false
  end

  ensure_replacement_build_exists!(
    app,
    platform,
    app_version: app_version,
    build_number: build_number
  )

  submission.cancel_submission`,
      `  ensure_replacement_build_exists!(
    app,
    platform,
    app_version: app_version,
    build_number: build_number
  )

  submission.cancel_submission

  unless review_cancellation_allowed?
    return false
  end`
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, gateTooLate)).toContain(
      'asc_version_slot.rb: cancel_submission must be guarded by review_cancellation_allowed?'
    );
  });

  it('rejects a helper missing the slot-readiness entry point entirely', () => {
    const withoutHelper = VALID_SLOT.replace(
      /def app_store_version_slot_ready\?\(app_version:, build_number:\)/,
      'def something_else'
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, withoutHelper)).toContain(
      'asc_version_slot.rb: missing app_store_version_slot_ready? — submit would crash when the editable version slot is occupied'
    );
  });

  it('ignores commented-out guard calls', () => {
    const commentedGuard = VALID_FASTFILE.replace(
      '  unless app_store_version_slot_ready?',
      '  # unless app_store_version_slot_ready?'
    );

    expect(
      validateFastfileSubmitVersionGuard(commentedGuard, VALID_SLOT).length
    ).toBeGreaterThan(0);
  });
});

describe('bugfix: cancelling review could strand the app with nothing under review', () => {
  it('rejects withdrawing the live review before the replacement build is confirmed', () => {
    const cancelFirst = VALID_SLOT.replace(
      /  ensure_replacement_build_exists!\(\n    app,\n    platform,\n    app_version: app_version,\n    build_number: build_number\n  \)\n\n/,
      ''
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, cancelFirst)).toContain(
      'asc_version_slot.rb: ensure_replacement_build_exists! must run BEFORE cancel_submission withdraws the live review'
    );
  });

  it('rejects treating the vanished in-progress submission as an editable version', () => {
    // Apple flips the submission to CANCELING, which drops out of
    // get_in_progress_review_submission's filter before the version is editable.
    const pollsWrongResource = VALID_SLOT.replace(
      '    version = app.get_edit_app_store_version(platform: platform)',
      '    version = app.get_in_progress_review_submission(platform: platform)'
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, pollsWrongResource)).toContain(
      'asc_version_slot.rb: wait_for_editable_app_store_version must poll get_edit_app_store_version, not the in-progress review submission'
    );
  });

  it('rejects skipping the editable-version wait after cancellation', () => {
    const noWait = VALID_SLOT.replace(
      '  return true if wait_for_editable_app_store_version(app, platform)\n\n  UI.user_error!("cancelled but no editable version appeared")',
      '  true'
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, noWait)).toContain(
      'asc_version_slot.rb: after cancel_submission the lane must wait via wait_for_editable_app_store_version'
    );
  });

  it('rejects exiting green when the withdrawn review never frees the version', () => {
    const silentTimeout = VALID_SLOT.replace(
      '  UI.user_error!("cancelled but no editable version appeared")',
      '  UI.important("timed out")\n  false'
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, silentTimeout)).toContain(
      'asc_version_slot.rb: a post-cancellation timeout must fail the lane, not skip — the previous submission is already withdrawn'
    );
  });

  it('rejects accepting a build that is still processing, failed or invalid', () => {
    const anyProcessingState = VALID_SLOT.replace(
      ',\n    processing_states: SUBMITTABLE_BUILD_PROCESSING_STATE',
      ''
    );

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, anyProcessingState)).toContain(
      'asc_version_slot.rb: ensure_replacement_build_exists! must filter on processing_states so unusable builds cannot pass'
    );
  });

  it('rejects accepting an expired build as the replacement', () => {
    const keepsExpired = VALID_SLOT.replace('.reject(&:expired)', '');

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, keepsExpired)).toContain(
      'asc_version_slot.rb: ensure_replacement_build_exists! must reject expired builds'
    );
  });

  it('rejects a latest-build lookup that ignores the requested app version', () => {
    const unscoped = VALID_SLOT.replace('    version: requested_version,\n', '');

    expect(validateFastfileSubmitVersionGuard(VALID_FASTFILE, unscoped)).toContain(
      'asc_version_slot.rb: ensure_replacement_build_exists! must scope the lookup to the requested app version'
    );
  });
});

describe('bugfix: reject_if_possible silently withdrew a live App Review', () => {
  it('rejects a submit lane whose deliver passes reject_if_possible', () => {
    // deliver's own reject_if_possible cancels whatever is in App Review,
    // bypassing the opt-in guard — it withdrew build 2.1.527 when 2.1.528 shipped.
    const withRejectIfPossible = VALID_FASTFILE.replace(
      `  deliver_opts = {
    submit_for_review: true
  }`,
      `  deliver_opts = {
    reject_if_possible: true,
    submit_for_review: true
  }`
    );

    expect(
      validateFastfileSubmitVersionGuard(withRejectIfPossible, VALID_SLOT)
    ).toContain(
      'Fastfile: submit lane must not pass reject_if_possible — cancellation is owned solely by app_store_version_slot_ready? (opt-in via IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT); deliver reject_if_possible is an unguarded second path that withdraws live App Reviews'
    );
  });
});
