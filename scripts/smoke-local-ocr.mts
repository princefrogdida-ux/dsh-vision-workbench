import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { LazyTesseractOcrBackend } from '../src/local-ocr.js'

const languagePath = fileURLToPath(
  new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int/', import.meta.url),
)
const svg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320">
    <rect width="1200" height="320" fill="white"/>
    <text x="60" y="215" font-family="Arial, sans-serif" font-size="170" font-weight="700" fill="black">HELLO 123</text>
  </svg>
`)
const imageBytes = await sharp(svg).png().toBuffer()
const backend = new LazyTesseractOcrBackend({
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
  const signal = AbortSignal.timeout(60000)
  const result = await backend.recognize({
    id: 'offline-smoke',
    mediaType: 'image/png',
    bytes: imageBytes,
    width: 1200,
    height: 320,
  }, signal)
  assert.match(result.text, /HELLO\s+123/i)
  assert.ok(result.confidence >= 40, `unexpectedly low confidence: ${result.confidence}`)
  process.stdout.write(JSON.stringify({
    text: result.text,
    confidence: result.confidence,
    regions: result.regions.length,
    languagePath,
    networkRequired: false,
  }, null, 2) + '\n')
} finally {
  await backend.dispose()
}
