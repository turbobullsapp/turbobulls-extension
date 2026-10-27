# Releasing

How a version of the extension is made, and what its number promises.

## Version numbers

Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **Major** (2.0.0): you need to do something, or the protocol the Turbobulls app speaks
  ([PROTOCOL.md](PROTOCOL.md)) changes in a way an older app would not understand.
- **Minor** (1.1.0): something new, such as a provider or an option, that changes nothing you rely
  on.
- **Patch** (1.0.1): fixes only.

Only the latest version gets fixes, security fixes included ([SECURITY.md](SECURITY.md)).

## The rules every release follows

- **From `main` only.** A release is a tag `v<version>` on a commit of `main`. The workflow refuses
  a tag on any other commit, a tag whose number differs from `package.json`, and a version that
  CHANGELOG.md does not describe.
- **Tags are permanent.** Only maintainers can create `v*` tags, and nobody can move or delete one.
  A mistake is fixed with a new version, never by moving a tag. Releases are immutable once
  published.
- **A maintainer approves.** The publishing jobs wait in the `release` environment until a
  maintainer approves them, and the environment accepts only `v*` tags.
- **Built by GitHub, never on a computer.** The build job runs the checks and builds the packages
  with no right to publish anything. The publishing jobs run no build tools: they take the build
  job's packages as they are.
- **Changes reach `main` only through pull requests** whose checks pass (tests, CodeQL), and
  dependencies wait a week after their own release before Dependabot proposes them.

## Making a release

1. **Prepare it in a pull request.** Move the **Unreleased** notes in CHANGELOG.md under the new
   version with today's date, and bump `version` in `package.json` (the manifest takes it from there). Merge once the checks pass.
2. **Tag the merged commit:**

   ```bash
   git switch main && git pull --ff-only
   git tag v1.2.3 && git push origin v1.2.3
   ```

3. **Approve** the run in the `release` environment (Actions tab).
4. The workflow checks everything again, builds, and publishes the GitHub release with the
   CHANGELOG.md notes for that version.
5. **Upload to the stores.** The GitHub release holds two packages:
   `turbobulls-extension-<version>-chrome.zip` for the Chrome Web Store and
   `turbobulls-extension-<version>-edge.zip` for Edge Add-ons. Upload those two files, never a
   package built on a computer, with the release's notes as the store's "what's new".

## Checking a release

Every package the workflow builds carries a signed statement of where it was built. Check a
downloaded package with the GitHub CLI:

```bash
gh attestation verify turbobulls-extension-1.0.0-chrome.zip --repo turbobullsapp/turbobulls-extension
```

The stores re-sign what they publish, so this checks the files on the GitHub release, which are
the ones uploaded.
