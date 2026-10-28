# Desktop-owned session reader

This Desktop fork is the sole maintenance entry point for the server customization. The official DSH Git submodule and release tarballs remain unchanged. No separate personal framework fork is required.

**Current status:** source ownership, generated package patch and rebuild tooling are saved here. Default Desktop packaging integration is pending: dependency fetching was stopped at the user's request, so root resolutions and lockfile intentionally remain unchanged. Existing installed Desktop continues using its verified rc.2 profile overlay. Do not claim that an ordinary build of this branch already includes the reader endpoints.

## Ownership

- `source.patch` is the authored TypeScript implementation and projection tests, against the official commit recorded in `upstream.json`.
- `package.patch` is its generated package patch. Do not edit it independently.
- `scripts/build-session-reader-patch.mjs` rebuilds the package patch and `provenance.json` from an isolated, matching official source checkout.
- To enable default packaging later, copy the generated patch to `patches/dsh-api-session-controller@0.2.1-rc.3.patch`, update both exact/caret root resolutions to Yarn patch selectors and regenerate `yarn.lock` together. Never publish a half-updated resolution/lock pair.
- `scripts/session-reader-patch.test.mjs` checks the patched package, old schemas, exposed route methods, projection bounds and artifact provenance. The mobile repository contains only the consumer and dependency documentation.

## Contract

The additive `session/readerPage` and `session/readerFollow` endpoints retain existing authorization and leave raw `session/page` and `session/follow` unchanged. Reader v1 keeps human input, public assistant text, lightweight tool name/description/status, explicit artifact references and turn lifecycle. It excludes raw tool output/arguments, reasoning, replay metadata and injected context.

Defaults are 128 raw sequence positions and 262144 UTF-8 bytes of record JSON; one indivisible oversized public row remains intact. The acknowledgement reports inclusive coverage, next-before cursor, bytes and oversize status. Excluded positions use `reader/skip` placeholders, preserving durable continuity. Transient assistant counters may be sparse. Current goal/task/control projections remain unchanged. Clients must validate acknowledgement and use a separate reader cache; this is not valid model replay data.

## Rebuild

Use an isolated checkout of the exact official `upstream.json` commit, with its pnpm dependencies installed. Do not edit Desktop's pinned submodule in place or reuse a newer framework checkout.

```sh
# In the isolated official source checkout:
git apply --check /path/to/dsh-desktop/runtime-customizations/session-reader/source.patch
git apply /path/to/dsh-desktop/runtime-customizations/session-reader/source.patch

# From Desktop, using that source checkout's tsx loader and build dependencies:
node --import /path/to/source/node_modules/tsx/dist/loader.mjs \
  scripts/build-session-reader-patch.mjs /path/to/source
# First enable the generated patch and both resolutions as described above.
corepack yarn install --mode=skip-build
node --test scripts/session-reader-patch.test.mjs
corepack yarn check:vendored-runtime
corepack yarn check:desktop-variants
```

Commit the authored source patch, generated package patch, provenance, resolution and lockfile changes together. A framework upgrade must regenerate and retest the patch against the new pin. Do not silently keep a patch for another version. Existing root Desktop packaging commands then consume the patched dependency; the normal market/bridge and platform-release prerequisites still apply.

The build helper preserves the published package metadata, locales and Desktop client bundle. It regenerates host/remote contracts from the pinned source. It records input hashes so the shipped patch can be traced to its source. Package compilation is not a signed Desktop release or validation of a running instance.

## Existing installations

Changing this repository does not change an already installed Desktop app. The earlier rc.2 profile overlay remains a separate compatibility deployment for the current installation. Keep it until a Desktop package built with this integration has been installed and its reader endpoints verified, then remove it through its saved rollback receipt. Do not remove the working overlay or restart a user's app merely while reorganizing source ownership.
