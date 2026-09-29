# Mooner illustrated attributes

These source sheets were generated with the built-in image-generation tool using the user's Mooner reference and the approved sample in `source/approved-reference.png`. They are AI-generated artwork created for this project, not a downloaded stock collection. The supplied reference's original authorship was not established here. Source sheets are retained at their original resolution and transparency.

The generator composes separate eyes, mouths, headwear, eyewear, outfits, neckwear, auras, and backgrounds. All 89 existing traits, unlocks, blockers, and saved-profile fields remain available. Twelve ordinary skin colors remap the neutral illustrated head through six interpolated material bands; eight special skins use their own illustrated material heads. The common spike pair follows the selected palette.

The source of truth is `sprites.json`: explicit source cells, optional masks for neighboring-cell overlap, destination rectangles, anatomical mask polygons, and registration options. Explicit stretch rectangles preserve contact widths; aspect-fit boxes are used only where the source aspect is appropriate. Coordinates refer to a virtual source-sheet width of 1280 pixels, preserving each actual source's aspect ratio. Crops retain black eye sockets and white highlights. Preparation uses real PNG alpha, removes disconnected fragments below 1.2% of the largest component, trims transparent margins, and resamples with nearest neighbors. Explicit masks remove adjoining-sheet fragments where generated rows overlap.

The shared skull is 224×204 at (16,43). Beanie/cap contact widths wrap the skull; crown and party artwork use closed worn rims. Horns and spikes are separate roots behind the moon silhouette. Neutral socket outlines follow the selected skin palette, while the pupil interiors retain their authored color. Mouths register to the facial opening independently of their tongue or bubble extents. Headphones have a rear band and separate temple cups. Opaque eyewear hides eye sockets; a monocle preserves the selected eye underneath. The orbit is split along its diagonal into rear and front layers.

Outfit portraits use one 0.84 character rig at (20,0), including attached neckwear, while a 210-pixel torso draws behind the head. The spacesuit additionally has a source-polygon front collar that overlaps the bottom of the skull. Neckwear alone never resizes the head. Necklace arcs and pendants are separate sprites so gems retain their shape. Bowtie wings remain visible around the tongue. All placements still need visual review: geometry tests cannot establish illustration quality.

The checked-in atlas and TypeScript manifest are generated outputs. Both the main app and simulation load the same atlas once through a Vite asset URL. Composition runs at 256 pixels. A 512-pixel export repeats these pixels exactly; 128-pixel output uses center-sampled nearest neighbors. No smoothing is applied. Browser picture caches are versioned in both PFP loaders.

## Rebuild and verify

Run from the repository root, with the existing web dependencies installed (`pngjs` is already provided by them):

```sh
node art/mooner/prepare.mjs
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/pfp-pixels.test.mjs
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs art/mooner/preview.mjs /tmp/mooner-sprite-preview.png
```

The tests decode the actual production PNG, verify every catalog layer exists, exercise all 89 traits and blocked combinations, inspect neckwear across outfits, verify transparent holes, and check deterministic scaling. Fit regressions cover unchanged skull geometry when wearing neckwear, visible bowtie wings with the tongue, actual front-collar overlap, and preserved white star pupils. Review the rendered contact sheet when changing source art or placement; different pixel hashes alone do not establish good alignment. Build the app and simulation with `npm run build` from `web/`, and bump both PFP cache versions after artwork changes.

For the neutral-background stress sheet (headwear, mouths on light and dark skin, outfits, neckwear with and without a hoodie, and all eyes on obsidian):

```sh
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs art/mooner/fit-preview.mjs /tmp/mooner-fit-stress.png
```
