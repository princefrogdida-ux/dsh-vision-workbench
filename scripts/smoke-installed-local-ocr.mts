import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const installedRoot = process.argv[2]
const languagePath = process.argv[3]
if (installedRoot === undefined || languagePath === undefined) {
  throw new Error('usage: smoke-installed-local-ocr.mts <installed-plugin-root> <language-path>')
}

const installed = await import(pathToFileURL(join(installedRoot, 'lib', 'index.js')).href) as {
  LazyTesseractOcrBackend: new (config: Record<string, unknown>) => {
    recognize(image: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; confidence: number }>
    dispose(): Promise<void>
  }
}
const svg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320">
    <rect width="1200" height="320" fill="white"/>
    <text x="60" y="215" font-family="Arial, sans-serif" font-size="170" font-weight="700" fill="black">HELLO 123</text>
  </svg>
`)
const imageBytes = await sharp(svg).png().toBuffer()
const backend = new installed.LazyTesseractOcrBackend({
  enabled: true,
  languagePath,
  languages: ['eng'],
  gzip: true,
  timeoutMs: 60000,
  maxLanguageBytes: 50 * 1024 * 1024,
  maxRegions: 50,
  pageSegMode: 'single-block',
  autoRotate: false,
  lowConfidenceThreshold: 40,
})
try {
  const result = await backend.recognize({
    id: 'installed-offline-smoke',
    mediaType: 'image/png',
    bytes: imageBytes,
    width: 1200,
    height: 320,
  }, AbortSignal.timeout(60000))
  assert.match(result.text, /HELLO\s+123/i)
  assert.ok(result.confidence >= 40)
  process.stdout.write(JSON.stringify({ text: result.text, confidence: result.confidence }) + '\n')
} finally {
  await backend.dispose()
}
