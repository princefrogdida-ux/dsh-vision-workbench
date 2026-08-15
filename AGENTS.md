# dsh-vision-workbench development rules

- Target the public DeepSeek Harness `0.1.0-rc.5` seams first. Do not import the stock DeepSeek adapter implementation.
- Keep the stock `deepseek-official` route untouched. This plugin owns only its configured visible wrapper route.
- Never add a built-in anonymous remote provider or log credential values.
- Model-visible image markers must remain a deterministic projection of durable image attachment references.
- Bind every registration and external resource to the Cordis fiber. HMR must not leave routes, tools, agents, timers, or caches behind.
- Phase 2 may use Sharp only through the lazy optional raster boundary. Missing native binaries must not prevent phase 1 from loading.
- Derived crop and diff images must be committed with `ctx.attachments.saveImage()` before their references enter a tool result.
- Local comparison never auto-resizes screenshots; dimension mismatch is evidence and must fail explicitly.
- Provider OCR uses the configured bounded router. Phase 5 local OCR is opt-in only: require explicit local language files, disable runtime download/cache writes, reuse one serialized worker, and terminate it on cancellation or disposal. Never silently fall back from local OCR to a remote provider.
- Phase 4 fallback is ordered and bounded. Never add anonymous endpoints, concurrent image fan-out, unlimited retry, or raw upstream error bodies to persisted tool results.
- User cancellation must stop provider routing immediately; every Provider client and dispatcher remains owned by the plugin disposer.
- Treat the official DeepSeek Harness checkout as read-only reference material unless a task explicitly targets upstream integration.
