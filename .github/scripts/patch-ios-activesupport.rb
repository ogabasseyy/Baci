# frozen_string_literal: true

require "bundler/setup"
require "digest"
require "tempfile"

# CocoaPods Core requires ActiveSupport < 8. Port the literal LoadError match
# from Rails 210ac22d446c8e2625b091e79256806b836eee20 (GHSA-8474-xrp6-wh69)
# until CocoaPods can use a patched published gem. A version/source change is
# deliberately a release blocker: review the upstream fix, then update or remove
# this backport and its digests alongside the lockfile change.
module IosActiveSupportBackport
  VERSION = "7.2.3.1"
  ORIGINAL_DIGEST = "3b8028113ff51eac58aec28315a0acf95772decfd3f06f220b9431dcad911831"
  PATCHED_DIGEST = "9c6fa7ae3d2d0941426e83afa5ec58013cbaa04e85d3cdbfdf25bfecbd54e875"
  ORIGINAL_MATCH = '      raise unless /Unable to autoload constant #{const_regexp(camel_cased_word)}/.match?(message)'
  PATCHED_MATCH = [
    '      constant_name = camel_cased_word.split("::").find { |part| !part.empty? } || camel_cased_word',
    '      raise unless message.include?("Unable to autoload constant #{constant_name}")'
  ].join("\n")
  UNUSED_HELPER = <<'RUBY'
      # Mounts a regular expression, returned as a string to ease interpolation,
      # that will match part by part the given constant.
      #
      #   const_regexp("Foo::Bar::Baz") # => "Foo(::Bar(::Baz)?)?"
      #   const_regexp("::")            # => "::"
      def const_regexp(camel_cased_word)
        parts = camel_cased_word.split("::")

        return Regexp.escape(camel_cased_word) if parts.empty?

        last = parts.pop

        parts.reverse!.inject(last) do |acc, part|
          part.empty? ? acc : "#{part}(::#{acc})?"
        end
      end

RUBY

  def self.apply!(path:, version:)
    abort "Recheck the ActiveSupport backport for #{version}" unless version.to_s == VERSION

    source = File.binread(path)
    digest = Digest::SHA256.hexdigest(source)
    return :already_patched if digest == PATCHED_DIGEST
    abort "Unexpected ActiveSupport source digest in #{path}" unless digest == ORIGINAL_DIGEST

    patched = source.sub(ORIGINAL_MATCH, PATCHED_MATCH)
    abort "ActiveSupport backport helper was not found" if patched == source
    patched = patched.sub(UNUSED_HELPER, "")
    abort "ActiveSupport backport helper was not found" if patched.include?(UNUSED_HELPER)
    abort "ActiveSupport backport output did not match the expected digest" unless Digest::SHA256.hexdigest(patched) == PATCHED_DIGEST

    Tempfile.create(["activesupport-", ".rb"], File.dirname(path), binmode: true) do |file|
      file.write(patched)
      file.chmod(File.stat(path).mode & 0o777)
      file.close
      File.rename(file.path, path)
    end
    :patched
  end
end

if $PROGRAM_NAME == __FILE__
  gem_spec = Gem.loaded_specs.fetch("activesupport")
  path = File.join(gem_spec.full_gem_path, "lib/active_support/inflector/methods.rb")
  IosActiveSupportBackport.apply!(path: path, version: gem_spec.version)
end
