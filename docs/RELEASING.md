# Releasing the signed macOS app

Only maintainers should run this process. Releases are tag-driven and fail if
the Git tag, package version, lockfile, signing credentials, tests, or build do
not agree.

## One-time Apple and GitHub setup

1. Enroll in the Apple Developer Program.
2. Create a **Developer ID Application** certificate and export it from Keychain
   Access as a password-protected `.p12` file.
3. Create an app-specific password for notarization and record the Apple Team ID.
4. In GitHub, create an environment named `release` and add these environment
   secrets:
   - `CSC_LINK` — base64-encoded `.p12` or another electron-builder-supported reference
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
5. Add a required reviewer to the `release` environment when another maintainer
   is available.

Never place a certificate or credential in the repository. Common certificate
and environment-file extensions are ignored as an additional guardrail.

## Prepare a release

Create a focused release branch and update the version without creating a tag:

```bash
git switch -c release/v0.1.2
npm version 0.1.2 --no-git-tag-version
npm run notices
npm run verify
```

Update `CHANGELOG.md`, open a pull request, and merge only after CI passes.

## Publish

From an up-to-date, clean `main` branch:

```bash
git switch main
git pull --ff-only
git tag -s v0.1.2
git push origin v0.1.2
```

The release workflow validates credentials and version alignment, reruns tests,
signs and notarizes the app, publishes the DMG/ZIP updater assets, and uploads
checksums plus third-party/source notices.

## Verify the published release

On a Mac that did not build the app:

1. Compare downloaded artifacts with `SHA256SUMS.txt`.
2. Open the DMG, install the app, and confirm Gatekeeper does not warn.
3. Run `codesign --verify --deep --strict --verbose=2 /Applications/Wiggle\ GPL.app`.
4. Run `spctl --assess --type execute --verbose=4 /Applications/Wiggle\ GPL.app`.
5. Confirm the About version, save/load, WebM export, MP4 export with audio, and
   updater behavior.
6. Confirm `LICENSE`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, the Chromium
   notices, and the FFmpeg source manifest are inside the app resources and
   attached where documented.
