import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Config } from '../src/config.js'

test('phase 6 package exposes a Web client and defaults to a safe credential reference', async () => {
  const resolved = Config({})
  assert.equal(resolved.enabled, false)
  assert.equal(resolved.visionProvider.credentialRef, 'VISION_API_KEY')

  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, unknown>
    dsh: { client?: { platform?: string; inject?: string[] } }
  }
  assert.ok(manifest.exports['./client'])
  assert.equal(manifest.dsh.client?.platform, 'web')
  assert.ok(manifest.dsh.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
})

test('visual form keeps API keys on the write-only credentials path', async () => {
  const controller = await readFile(new URL('../src/client/controller.ts', import.meta.url), 'utf8')
  const card = await readFile(new URL('../src/client/VisionWorkbenchCard.tsx', import.meta.url), 'utf8')
  const schema = await readFile(new URL('../src/config.ts', import.meta.url), 'utf8')

  assert.match(controller, /credentials\.set\(/)
  assert.match(controller, /credentials\.describe\(/)
  assert.match(card, /type="password"/)
  assert.doesNotMatch(schema, /apiKey\s*:/)
})
