# frozen_string_literal: true

require "bundler/setup"
require "fileutils"
require "tmpdir"
require_relative "patch-ios-activesupport"

def assert_equal(expected, actual, message)
  raise "#{message}: expected #{expected.inspect}, got #{actual.inspect}" unless expected == actual
end

def assert_includes(string, substring, message)
  raise "#{message}: missing #{substring.inspect}" unless string.include?(substring)
end

def refute_includes(string, substring, message)
  raise "#{message}: unexpectedly found #{substring.inspect}" if string.include?(substring)
end

def with_fixture
  source_path = File.join(
    Gem.loaded_specs.fetch("activesupport").full_gem_path,
    "lib/active_support/inflector/methods.rb"
  )
  Dir.mktmpdir("ios-activesupport-backport-test-") do |temp_dir|
    fixture_path = File.join(temp_dir, "methods.rb")
    FileUtils.cp(source_path, fixture_path)
    yield fixture_path
  end
end

def run_test(name)
  yield
  puts "PASS #{name}"
rescue StandardError => error
  warn "FAIL #{name}: #{error.message}"
  exit 1
end

run_test("patches pinned source, removes regex helper, and preserves normal lookups") do
  with_fixture do |fixture_path|
    assert_equal(:patched, IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1"), "first patch")

    patched_source = File.binread(fixture_path)
    assert_equal(IosActiveSupportBackport::PATCHED_DIGEST, Digest::SHA256.hexdigest(patched_source), "patched digest")
    assert_includes(patched_source, 'message.include?("Unable to autoload constant #{constant_name}")', "literal lookup")
    refute_includes(patched_source, "const_regexp", "removed helper")
    refute_includes(patched_source, IosActiveSupportBackport::ORIGINAL_MATCH, "removed dynamic matcher")

    assert_equal(:already_patched, IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1"), "repeat patch")
    assert_equal(patched_source, File.binread(fixture_path), "idempotent bytes")

    require "active_support/inflector"
    load fixture_path
    assert_equal(String, ActiveSupport::Inflector.safe_constantize("String"), "ordinary constant lookup")
    assert_equal(nil, ActiveSupport::Inflector.safe_constantize("DefinitelyMissingConstant"), "unknown constant lookup")
  end
end

run_test("rejects unexpected source without modifying it") do
  with_fixture do |fixture_path|
    File.open(fixture_path, "ab") { |file| file.write("\n# unexpected source change\n") }
    original = File.binread(fixture_path)

    begin
      IosActiveSupportBackport.apply!(path: fixture_path, version: "7.2.3.1")
      raise "unexpected source was accepted"
    rescue SystemExit => error
      assert_equal(1, error.status, "unexpected source exit status")
    end

    assert_equal(original, File.binread(fixture_path), "unexpected source remains unchanged")
  end
end
