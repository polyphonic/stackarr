# Changelog

## [0.3.0-alpha.2](https://github.com/polyphonic/stackarr/compare/v0.3.0-alpha.1...v0.3.0-alpha.2) (2026-07-14)


### Added

* **app:** stabilize sessions and add opt-in telemetry ([ee1ae76](https://github.com/polyphonic/stackarr/commit/ee1ae7693d5204f444193ea9e7134e7cd05f12cc))
* **media:** scrape Arr imports with tinyMediaManager ([7e68a8c](https://github.com/polyphonic/stackarr/commit/7e68a8c4a7413854ab0df0c5878303fec3727f74))
* **telemetry:** add protected collector infrastructure ([aada769](https://github.com/polyphonic/stackarr/commit/aada76987fe6db03ae617b549791922c4bb16e5f))


### Fixed

* **build:** finalize production telemetry image ([bd275c8](https://github.com/polyphonic/stackarr/commit/bd275c8f34b5b310ab52ceab09d2801d725293fd))
* **docs:** generate sources before typecheck ([5dbe2d3](https://github.com/polyphonic/stackarr/commit/5dbe2d3a75ce56592659c85836cf5cb4508f6451))
* **release:** validate and gate alpha releases ([9de0f90](https://github.com/polyphonic/stackarr/commit/9de0f90d9001183f8fbafa2899e71cfbfcc5e749))


### Changed

* streamline app workflows and state handling ([aa8f019](https://github.com/polyphonic/stackarr/commit/aa8f019e7e95d9cdea32d91d8ea5d0ce509c010f))


### Continuous integration

* **release:** add alpha container release pipeline ([79ac1b1](https://github.com/polyphonic/stackarr/commit/79ac1b1e8a2f654600bd15c3c4d9706bace2b882))
* **release:** configure Docker Hub username ([d96afc1](https://github.com/polyphonic/stackarr/commit/d96afc1ec0e93e5e59382b686eae940a49b71bce))

All notable Stackarr releases are documented here. This file is maintained by Release Please from Conventional Commits; released image digests and upgrade guidance are published with the matching GitHub Release.

## Release channels

- `alpha` — moving pre-release channel for feedback; always pair a report with the immutable version or digest.
- Stable releases — published only after Stackarr leaves prerelease; tagged with the exact version, `major.minor`, `major`, and `latest`.
