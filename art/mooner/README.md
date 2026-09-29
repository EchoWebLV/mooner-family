# Mooner illustrated attributes

These source sheets were generated with the built-in image-generation tool using the user's Mooner reference and the approved sample in `source/approved-reference.png`. They are AI-generated artwork created for this project, not a downloaded stock collection. The supplied reference's original authorship was not established here. Source sheets are retained at their original resolution and transparency.

The generator composes separate eyes, mouths, headwear, eyewear, outfits, neckwear, auras, and backgrounds. All 89 existing traits, unlocks, blockers, and saved-profile fields remain available. Twelve ordinary skin colors remap the neutral illustrated head through six interpolated material bands; eight special skins use their own illustrated material heads. The common spike pair follows the selected palette.

The source of truth is `sprites.json`: explicit source cells, optional masks for neighboring-cell overlap, destination rectangles, and registration options. Coordinates refer to a virtual source-sheet width of 1280 pixels, preserving each actual source's aspect ratio. Crops retain black eye sockets and white highlights. Preparation uses real PNG alpha, removes disconnected fragments below 1.2% of the largest component, trims transparent margins, and resamples with nearest neighbors. Explicit masks remove adjoining-sheet fragments where generated rows overlap.

Anatomical placement is intentional: paired eyes share a perspective and bottom line, mouths align by their opening, hats meet the forehead, and neck accessories meet the chin. Headphones have a rear band and separate side cups. Opaque eyewear hides eye sockets; a monocle preserves the selected eye underneath. The orbit is split along its diagonal into rear and front layers. Outfit framing leaves space for the torso; neckwear-only framing leaves room for pendants.

The checked-in atlas and TypeScript manifest are generated outputs. Both the main app and simulation load the same atlas once through a Vite asset URL. Composition runs at 256 pixels. A 512-pixel export repeats these pixels exactly; 128-pixel output uses center-sampled nearest neighbors. No smoothing is applied. Browser picture caches are versioned in both PFP loaders.

## Rebuild and verify

Run from the repository root, with the existing web dependencies installed (`pngjs` is already provided by them):

```sh
node art/mooner/prepare.mjs
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/pfp-pixels.test.mjs
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs art/mooner/preview.mjs /tmp/mooner-sprite-preview.png
```

The tests decode the actual production PNG, verify every catalog layer exists, exercise all 89 traits and blocked combinations, inspect neckwear across outfits, verify transparent holes, and check deterministic scaling. Review the rendered contact sheet when changing source art or placement; different pixel hashes alone do not establish good alignment. Build the app and simulation with `npm run build` from `web/`, and bump both PFP cache versions after artwork changes.
