# frozen_string_literal: true

require "bundler/setup"
require "fileutils"
require "minitest/autorun"
require "tmpdir"
require_relative "patch-ios-activesupport"

class PatchIosActiveSupportTest < Minitest::Test
  def setup
    @source_path = File.join(
      Gem.loaded_specs.fetch("activesupport").full_gem_path,
      "lib/active_support/inflector/methods.rb"
    )
    @temp_dir = Dir.mktmpdir("ios-activesupport-backport-test-")
    @fixture_path = File.join(@temp_dir, "methods.rb")
    FileUtils.cp(@source_path, @fixture_path)
  end

  def teardown
    FileUtils.remove_entry(@temp_dir)
  end

  def test_patches_pinned_source_to_literal_matching_and_preserves_normal_inflection
    assert_equal :patched, IosActiveSupportBackport.apply!(path: @fixture_path, version: "7.2.3.1")

    patched_source = File.binread(@fixture_path)
    assert_equal IosActiveSupportBackport::PATCHED_DIGEST, Digest::SHA256.hexdigest(patched_source)
    assert_includes patched_source, 'message.include?("Unable to autoload constant #{constant_name}")'
    refute_includes patched_source, "const_regexp"
    refute_includes patched_source, IosActiveSupportBackport::ORIGINAL_MATCH

    assert_equal :already_patched, IosActiveSupportBackport.apply!(path: @fixture_path, version: "7.2.3.1")
    assert_equal patched_source, File.binread(@fixture_path)

    require "active_support/inflector"
    load @fixture_path
    assert_equal String, ActiveSupport::Inflector.safe_constantize("String")
    assert_nil ActiveSupport::Inflector.safe_constantize("DefinitelyMissingConstant")
  end

  def test_rejects_unexpected_source_without_modifying_it
    File.open(@fixture_path, "ab") { |file| file.write("\n# unexpected source change\n") }
    original = File.binread(@fixture_path)

    error = assert_raises(SystemExit) do
      IosActiveSupportBackport.apply!(path: @fixture_path, version: "7.2.3.1")
    end

    assert_equal 1, error.status
    assert_equal original, File.binread(@fixture_path)
  end
end
