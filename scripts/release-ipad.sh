#!/bin/zsh
# Archives the iPad app and uploads it to App Store Connect for TestFlight.
#
#   pnpm release:ipad
#
# Needs apps/ipad/Config/Signing.local.xcconfig (DEVELOPMENT_TEAM = …) and an App Store
# Connect API key: ASC_KEY_ID and ASC_ISSUER_ID in the environment, with the key file at
# ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8 (see docs/releasing.md). The
# build shows up in TestFlight once Apple has processed it, usually within 15 minutes.
set -euo pipefail
cd "$(dirname "$0")/../apps/ipad"

fail() { print -u2 "\n✗ $1"; exit 1; }
[[ -f Config/Signing.local.xcconfig ]] || fail "Create apps/ipad/Config/Signing.local.xcconfig with your team: DEVELOPMENT_TEAM = ABCDE12345"
[[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]] || fail "Set ASC_KEY_ID and ASC_ISSUER_ID (your App Store Connect API key)."
KEY=~/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8
[[ -f $KEY ]] || fail "No API key at $KEY"
[[ -z "$(git status --porcelain)" ]] || fail "Commit or stash your changes first."

VERSION=$(sed -nE 's/.*MARKETING_VERSION: ([0-9.]+).*/\1/p' project.yml)
BUILD=$(sed -nE 's/.*CURRENT_PROJECT_VERSION: "([0-9]+)".*/\1/p' project.yml)
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

print "\n▸ Typink for iPad $VERSION ($BUILD): checks"
swift run core-checks

print "\n▸ Archiving"
rm -rf build
xcodegen generate --quiet
xcodebuild archive -quiet -project TypinkPad.xcodeproj -scheme TypinkPad -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/TypinkPad.xcarchive "${AUTH[@]}"

print "\n▸ Uploading to App Store Connect"
xcodebuild -exportArchive -archivePath build/TypinkPad.xcarchive -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export "${AUTH[@]}"

print "\n✓ Uploaded Typink $VERSION ($BUILD). It appears in TestFlight once Apple has processed it."
