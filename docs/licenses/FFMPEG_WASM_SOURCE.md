# FFmpeg WebAssembly source and license manifest

Wigo Studio bundles `ffmpeg-core.wasm` from `@ffmpeg/core@0.12.6` for H.264
export. The wrapper packages declare MIT, but the WebAssembly binary is built
from FFmpeg and external codec libraries under their own licenses.

## Pinned binary

- npm package: `@ffmpeg/core@0.12.6`
- npm source commit: `e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4`
- source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4
- packaged WASM SHA-256: `2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61`

The pinned Dockerfile builds FFmpeg `n5.1.4` with `--enable-gpl` and links
GPL-compatible codec libraries including x264 and x265. Treat the distributed
WASM core as GPL-covered, not merely as MIT wrapper code.

## Rebuilding and corresponding source

The source commit above contains the Dockerfile, build scripts, patches, and
the exact upstream branches/tags used for FFmpeg and its linked libraries.
Clone that commit and follow its production single-thread build target:

```bash
git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git
cd ffmpeg.wasm
git checkout e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4
make prd
```

Every Wigo Studio binary release must include this manifest and a link to the
same-tag Wigo Studio source. Before a long-lived public binary distribution,
archive the recursively fetched FFmpeg and codec sources alongside the release
so availability does not depend solely on third-party repositories.
