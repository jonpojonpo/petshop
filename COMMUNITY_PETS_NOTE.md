# JP's request: implement community pet adoption

JP discovered `npx codex-pets add nyan-cat` in a side conversation and explicitly
asked for this note requesting implementation in the main Petshop build.

## Requested addition

Integrate the community catalog at https://codex-pets.net into Petshop's strong
import flow. Let JP discover or enter a community pet slug, preview its body,
adopt it, and attach a Petshop character sheet with selectable model, harness,
equipment, billing mode, and leash. This supplies existing bodies without
requiring hatching to work first.

Support the underlying package's collection import where practical. Preserve
creator/source attribution, validate downloaded manifests and atlas geometry,
and handle an already-installed ID without silently overwriting its body.
Keep community bodies distinct from executable agent sheets: importing a body
must not itself start a model or grant tools/access.

## Verified evidence (2026-09-07)

- npm package: `codex-pets@0.3.0`, Node >=18, MIT-licensed CLI code.
  The CLI's license does not establish the license of community artwork.
- Commands:
  - `npx codex-pets add nyan-cat`
  - `npx codex-pets add-collection cats`
- Install destination: `$CODEX_HOME/pets/<id>/`, falling back to
  `~/.codex/pets/<id>/`.
- Installed files: `pet.json` and `spritesheet.webp`.
- Default API base: `https://codex-pets.net`.
- Package source uses:
  - `GET /api/pets/<slug>/share-data`
  - the returned `pet.downloadUrl`, falling back to `/api/pets/<slug>/download`
  - `GET /api/collections/<slug>` for collection metadata and pet summaries.
- The Nyan Cat metadata and actual downloaded ZIP were inspected in memory.
  Its manifest declares `spriteVersionNumber: 2`; its WebP is RGBA,
  **1536 x 2288**, matching Petshop's 8 x 11 atlas of 192 x 208 cells.
- Metadata includes creator handle, description, tags, poster/preview/atlas
  URLs, download URL, and a validation report. Nyan Cat's creator handle was
  `videokid`.
- No catalog-list/search endpoint was investigated. Discover that capability
  rather than inventing an endpoint or treating a guessed response as real.

Sources:

- https://www.npmjs.com/package/codex-pets
- https://registry.npmjs.org/codex-pets/-/codex-pets-0.3.0.tgz
- https://codex-pets.net/api/pets/nyan-cat/share-data

## Acceptance

From the shop/creator, preview and adopt `nyan-cat`, see it among available
bodies, and create a runnable sheet using that body. Existing local imports
must continue to work. Invalid packages, duplicate IDs, and network failures
must produce useful feedback. Keep source attribution available in the UI.

This side conversation only researched the package and wrote this note. It did
not install pets, add dependencies, or modify implementation or Git state.
