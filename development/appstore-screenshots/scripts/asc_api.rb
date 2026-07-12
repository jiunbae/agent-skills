#!/usr/bin/env ruby
# asc_api.rb <METHOD> <path> [json_body_or_@file]
# Minimal App Store Connect API client. ES256 JWT auth, no gem deps (openssl stdlib).
# Prints "HTTP <code>" then the response body — strip line 1 before JSON-parsing.
#
# Env (required):
#   ASC_KEY_ID       Key ID (matches AuthKey_<KEY_ID>.p8)
#   ASC_ISSUER_ID    Issuer UUID (ASC → Users and Access → Integrations)
# Env (optional):
#   ASC_KEY_FILEPATH .p8 path (default ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8)
#
# NOTE: macOS system ruby is < 3.0 — use classic `def`, not endless methods.
require "openssl"; require "json"; require "base64"; require "net/http"; require "uri"; require "time"

KEY_ID = ENV["ASC_KEY_ID"] or abort("set ASC_KEY_ID")
ISSUER = ENV["ASC_ISSUER_ID"] or abort("set ASC_ISSUER_ID")
KEYP   = ENV["ASC_KEY_FILEPATH"] || File.expand_path("~/.appstoreconnect/private_keys/AuthKey_#{KEY_ID}.p8")

def b64(s); Base64.urlsafe_encode64(s).delete("="); end
def jwt
  hdr = b64({alg: "ES256", kid: KEY_ID, typ: "JWT"}.to_json)
  now = Time.now.to_i
  pay = b64({iss: ISSUER, iat: now, exp: now + 1080, aud: "appstoreconnect-v1"}.to_json)
  data = "#{hdr}.#{pay}"
  key = OpenSSL::PKey::EC.new(File.read(KEYP))
  der = key.sign(OpenSSL::Digest::SHA256.new, data)
  a = OpenSSL::ASN1.decode(der)
  r = a.value[0].value.to_s(2).rjust(32, "\x00")
  s = a.value[1].value.to_s(2).rjust(32, "\x00")
  "#{data}.#{b64(r + s)}"
end

method, path = ARGV[0], ARGV[1]
body = ARGV[2]
body = File.read(body[1..]) if body&.start_with?("@")
url = path.start_with?("http") ? path : "https://api.appstoreconnect.apple.com#{path}"
uri = URI(url)
http = Net::HTTP.new(uri.host, uri.port); http.use_ssl = true
klass = {"GET"=>Net::HTTP::Get,"POST"=>Net::HTTP::Post,"PATCH"=>Net::HTTP::Patch,
         "DELETE"=>Net::HTTP::Delete,"PUT"=>Net::HTTP::Put}[method.upcase]
req = klass.new(uri.request_uri)
req["Authorization"] = "Bearer #{jwt}"
req["Content-Type"] = "application/json" if body
req.body = body if body
res = http.request(req)
puts "HTTP #{res.code}"
puts res.body unless res.body.to_s.empty?
