# Third-party notices

The architecture was informed by `ysr666/dsh-vision-router` at commit
`d8449a24e564460805ed04072688763a0566575b` (MIT at the reviewed commit).

This plugin is a new modular implementation for the DeepSeek Harness `0.1.0-rc.5`
public seams. It does not copy the upstream monolithic adapter, HTML screenshot,
Potrace, global fetch patch, or stealth-route takeover code.

Runtime dependencies retain their own licenses. See `package.json` and the lockfile
generated during the controlled dependency-install step.

Phase 2 can use Sharp as an optional local raster backend. Sharp is Apache-2.0 and
selects a platform-specific prebuilt libvips package at installation time. It is
not bundled into this source repository, and the phase 1 path remains usable when
the optional backend is unavailable.

Phase 3 can use Playwright Core 1.61.1 (Apache-2.0) as an optional browser-control
library. This plugin does not download or redistribute Playwright browser binaries;
on Windows it launches an already installed Microsoft Edge or Google Chrome channel.

Phase 5 can use Tesseract.js 7.0.0 and Tesseract.js Core 7.0.0 (Apache-2.0) as an
optional offline OCR backend. The production package does not contain or download
language data. `@tesseract.js-data/eng` 1.0.0 (MIT) is a development-only fixture used
by the offline smoke test and is excluded from the published plugin tarball.
