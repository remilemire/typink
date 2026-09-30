# Releasing Typink

The Mac app ships as a signed, notarized DMG on [GitHub Releases](https://github.com/remilemire/typink/releases)
and updates itself from there. The iPad app ships through TestFlight. Both carry the same
version number and build number.

## One-time setup

These are account and credential steps, so you do them yourself. The scripts only ever
read the keychain profile and key files.

1. **Apple Developer Program.** Enroll at <https://developer.apple.com/programs/enroll/> as an
   individual ($99 a year). Approval can take up to 48 hours.
2. **Certificates.** In Xcode › Settings › Accounts, add your Apple ID, choose your team, then
   click **Manage Certificates** › **+** to add:
   - **Developer ID Application**, which signs the Mac app for download outside the App Store.
   - **Apple Distribution**, which signs iPad builds for TestFlight.

   Keep a backup: in Keychain Access, export both as `.p12` files into your password manager.
3. **App Store Connect API key.** In App Store Connect › Users and Access › Integrations ›
   App Store Connect API › Team Keys, click **+** and choose the **App Manager** role.
   - Download `AuthKey_XXXXXXXXXX.p8`. You can only download it once.
   - Move it to `~/.appstoreconnect/private_keys/`.
   - Add the key ID and issuer ID to `~/.zshrc`:
     ```bash
     export ASC_KEY_ID=XXXXXXXXXX
     export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
     ```
4. **Notarization.** Store the same key in your keychain for `notarytool`:
   ```bash
   xcrun notarytool store-credentials typink-notary \
     --key ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8 --key-id $ASC_KEY_ID --issuer $ASC_ISSUER_ID
   ```
5. **iPad signing.** Create `apps/ipad/Config/Signing.local.xcconfig`, which git ignores:
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   ```
   Your team ID is the code in parentheses in `security find-identity -v -p codesigning`.
6. **App Store Connect app.** Go to Apps › **+** › New App:
   - Platform: iOS, bundle ID `app.typink.pad`, SKU `typink-ipad`.
   - Name: **Typink**. If it's taken, use *Typink Notes*; the Home Screen still says Typink.

   If the bundle ID isn't in the list yet, add it under Certificates, Identifiers & Profiles ›
   Identifiers.
7. **TestFlight.** Open the app's TestFlight tab.
   - **Test Information:** a short description, a feedback email, and the privacy policy URL
     `https://github.com/remilemire/typink/blob/main/PRIVACY.md`.
   - **Internal group:** create one and add yourself.
   - **Friends:** create an external group and turn on its **public link**. The first build of
     each version goes through Beta App Review, usually in under a day. In the review notes,
     say that the iPad app needs the free Mac app (link the DMG below) and works over the local
     network.

## Each release

1. On `dev`, set the new version and commit it:
   ```bash
   pnpm bump patch            # or: minor, major, 1.4.0
   git commit -am "Typink $(node -p "require('./apps/mac/package.json').version")"
   ```
2. Merge into `main`:
   ```bash
   git switch main && git merge --ff-only dev && git push origin main dev
   ```
3. **Mac:** run `pnpm release:mac`. It runs the tests, then builds, signs and notarizes the app,
   notarizes and staples the DMG, checks both the way Gatekeeper will, smoke-tests the signed
   app, tags `vX.Y.Z`, and creates a **draft** GitHub release.
   - Download the DMG from the draft in Safari and open it; it should open without warnings.
   - Then publish it:
     ```bash
     gh release edit vX.Y.Z --repo remilemire/typink --draft=false
     ```
   - Installed copies find the update within six hours, or right away with Typink › Check for
     Updates…. It installs when they quit.
4. **iPad:** run `pnpm release:ipad`. It archives the app and uploads it. When the build appears
   in TestFlight (usually within 15 minutes), add it to your groups.
5. Switch back to development with `git switch dev`.

The download link <https://github.com/remilemire/typink/releases/latest/download/Typink-arm64.dmg>
always points at the newest published release.

## When something goes wrong

- **Notarization rejected.** Run `xcrun notarytool log <submission id> --keychain-profile typink-notary`
  to see each problem.
- **A bad Mac release.** Turn it back into a draft:
  ```bash
  gh release edit vX.Y.Z --repo remilemire/typink --draft=true
  ```
  New checks stop offering it. Copies that already updated keep it until the next release, so
  ship a fixed patch.
- **A bad iPad build.** Go to App Store Connect › TestFlight › the build › **Expire Build**.
- **TestFlight builds expire after 90 days,** so upload at least once a quarter.
- **Updates only reach copies in /Applications** signed by the same team, which is why the app
  offers to move itself there. Builds from before 1.0.0 were unsigned, so they have to be
  replaced by hand once.
- **Testing a package without signing it:**
  ```bash
  pnpm --filter @typink/mac dist && pnpm --filter @typink/mac smoke
  ```
