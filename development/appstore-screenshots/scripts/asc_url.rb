# frozen_string_literal: true

require "uri"

# Defines the only URL boundary at which an App Store Connect JWT may be used.
module AscUrl
  ORIGIN = "https://api.appstoreconnect.apple.com"
  HOST = "api.appstoreconnect.apple.com"
  RELATIVE_V1_PATH = %r{\A/v1(?:/|\?|\z)}
  ABSOLUTE_V1_PATH = %r{\A/v1(?:/|\z)}

  class InvalidTarget < ArgumentError; end

  def self.authenticated_uri(target)
    raise InvalidTarget unless target.is_a?(String)

    candidate = target.match?(RELATIVE_V1_PATH) ? "#{ORIGIN}#{target}" : target
    uri = URI.parse(candidate)

    trusted = uri.is_a?(URI::HTTPS) &&
      uri.scheme == "https" &&
      uri.host == HOST &&
      uri.port == 443 &&
      uri.userinfo.nil? &&
      uri.fragment.nil? &&
      uri.path.match?(ABSOLUTE_V1_PATH)

    raise InvalidTarget unless trusted

    uri
  rescue URI::InvalidURIError
    raise InvalidTarget
  end
end
