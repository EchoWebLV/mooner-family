# Mooner 3D verification

The app and simulation import the same 3D renderer. The previous pixel sprites remain archived but are not loaded by the active picture adapter. Catalog IDs and saved profile shapes are unchanged.

Run geometry and GPU-resource ownership checks from the repository root:

```sh
node --experimental-strip-types --disable-warning=ExperimentalWarning --loader ./web/tests/resolve-ts.mjs --test web/tests/pfp-3d.test.mjs
```

Run production builds from `web` with `npm run build`.

For real WebGL verification, run `npm run dev` from `web` and open `/pfp-review.html?polished`. This development-only page is not a production build entry. It renders twelve mixed portraits, provides downloadable contact sheets and links to every trait group. Its **Run export checks** button checks simultaneous 128, 256 and 512 pixel PNG requests, verifies a repeated choice is byte-identical, and checks that unsupported sizes reject. Inspect the portraits at 256 pixels and in the actual small avatar/customizer UI.

The renderer uses a single private queue and stage, renders at a minimum of 512 pixels, and downsamples with high quality filtering. A lost graphics context invalidates the environment target even if the browser restores it between requests; a failed frame is rejected before PNG caching. Scene cleanup disposes temporary geometry, materials, textures and shadow targets while explicitly marked shared caches remain available. Cache version 17 replaces the pixel portraits.

The geometry tests use real Three.js geometry, not raster approximations. They check all ten mouth meshes for finite vertices and attachment to the lower face, distinguish the eight added eye expressions, and exercise resource cleanup with real Three.js disposal events.
