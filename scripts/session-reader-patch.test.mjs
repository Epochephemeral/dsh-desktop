import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, mkdtempSync, symlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..')
const require = createRequire(process.env.DSH_READER_TEST_RESOLVER ?? join(root, 'dsh-plugin-desktop/package.json'))
const installed = process.env.DSH_READER_TEST_PACKAGE ?? dirname(require.resolve('@deepseek-ai/dsh-api-session-controller/package.json'))
const provenance = JSON.parse(readFileSync(join(root, 'runtime-customizations/session-reader/provenance.json'), 'utf8'))
const tarball = join(root, `vendor/dsh-runtime/${provenance.packageVersion}/deepseek-ai-dsh-api-session-controller-${provenance.packageVersion}.tgz`)
const scratch = mkdtempSync(join(tmpdir(), 'reader-baseline-test-'))
execFileSync('tar', ['-xzf', tarball, '-C', scratch])
symlinkSync(process.env.DSH_READER_TEST_MODULES ?? join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir')
const original = join(scratch, 'package')
const load = path => import(pathToFileURL(path).href)
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const { readerEvent, readerPage, readerFrame } = await load(join(installed, 'lib/types/reader.js'))

test('source and generated patch match pinned provenance', () => {
  const upstream = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
  assert.equal(upstream.channels.stable.commit, provenance.sourceCommit)
  assert.equal(upstream.channels.beta.commit, provenance.sourceCommit)
  assert.equal(hash(tarball), provenance.publishedTarballSha256)
  assert.equal(hash(join(root, 'runtime-customizations/session-reader/source.patch')), provenance.sourcePatchSha256)
  assert.equal(hash(join(root, 'runtime-customizations/session-reader/package.patch')), provenance.generatedPatchSha256)
})
test('published metadata and Desktop client bundle are unchanged', () => {
  for (const file of ['package.json', 'lib/client.js']) assert.equal(hash(join(installed, file)), hash(join(original, file)))
})
test('all previous endpoint contracts remain exact and two reader routes are added', async () => {
  const old = (await load(join(original, 'lib/typert.host.js'))).TYPERT
  const now = (await load(join(installed, 'lib/typert.host.js'))).TYPERT
  assert.equal(now.invocations.length, old.invocations.length + 2)
  const shape = d => ({ service: d.service, namespace: d.namespace, method: d.method, invocation: d.invocation,
    scope: d.scope, cancellation: d.cancellation,
    parameters: d.parameters.map(p => ({ name: p.name, source: p.source, wire: p.wire,
      jsonSchema: p.codec.jsonSchema, strictJsonSchema: p.strictCodec?.jsonSchema })), result: d.result.spec.jsonSchema })
  for (const previous of old.invocations) {
    const current = now.invocations.find(x => x.id === previous.id)
    assert.ok(current, previous.id)
    assert.deepEqual(shape(current), shape(previous), previous.id)
  }
  for (const method of ['readerPage', 'readerFollow']) assert.ok(now.invocations.some(x => x.namespace === 'session' && x.method === method))
})
test('built main exposes reader and original route methods', async () => {
  const { SessionController } = await load(join(installed, 'lib/index.js'))
  for (const method of ['page', 'follow', 'readerPage', 'readerFollow']) {
    assert.equal(typeof SessionController.prototype[method], 'function')
  }
})
test('reader drops raw output and replay but preserves public text and tool status', () => {
  const event = (type, data) => ({ type, seq: 0, time: 1, data })
  const assistant = readerEvent(event('assistant/message', { message: { role: 'assistant', content: [
    { type: 'text', text: 'answer' }, { type: 'reasoning', text: 'private reasoning' }], source: { replayState: 'opaque' } }, stream: ['bulk'] }))
  assert.equal(JSON.stringify(assistant).includes('private reasoning'), false)
  assert.equal(JSON.stringify(assistant).includes('opaque'), false)
  assert.equal(assistant.data.message.content[0].text, 'answer')
  const result = readerEvent(event('tool/result', { message: { toolCallId: 'call', isError: false, content: [{ type: 'text', text: 'raw output' }] } }))
  assert.deepEqual(result.data.message.content, [])
  assert.equal(result.data.reader.status, 'completed')
})
test('page budgets count excluded rows and preserve sequence coverage', () => {
  const events = Array.from({ length: 400 }, (_, seq) => ({ type: 'request/header', seq, time: 1, data: { huge: 'x'.repeat(4096) } }))
  const page = readerPage(events, { maxRows: 128, maxBytes: 262144 }, 399)
  assert.equal(page.records.length, 128)
  assert.equal(page.reader.nextBeforeSeq, 272)
  assert.equal(page.reader.throughSeq, 399)
  assert.equal(page.hasMore, true)
  assert.ok(page.records.every(row => row.event.type === 'reader/skip'))
})
