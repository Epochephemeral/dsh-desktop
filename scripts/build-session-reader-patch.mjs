// Build the Desktop-owned reader customization against the pinned official source.
// Usage: node --import /path/to/source/node_modules/tsx/dist/loader.mjs scripts/build-session-reader-patch.mjs /path/to/patched-source
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const source = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw Error('Pass an isolated checkout of the pinned official DSH source with source.patch applied')
const metadata = JSON.parse(readFileSync(join(root, 'upstream.json'), 'utf8'))
const pin = metadata.channels.stable
if (pin.commit !== metadata.channels.beta.commit || pin.sourceVersion !== metadata.channels.beta.sourceVersion) {
  throw Error('Build separate channel patches when Stable and Beta use different sources')
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
if (head !== pin.commit) throw Error(`Source ${head} does not match Desktop pin ${pin.commit}`)
const sourcePatch = join(root, 'runtime-customizations/session-reader/source.patch')
execFileSync('git', ['apply', '--reverse', '--check', sourcePatch], { cwd: source })
const require = createRequire(join(source, 'package.json'))
const ts = (await import(pathToFileURL(require.resolve('typescript')))).default
const { build } = await import(pathToFileURL(require.resolve('tsdown')))
const { WorkspaceTypertGenerator } = await import(pathToFileURL(join(source, 'packages/typert/generator/src/workspace.ts')))
const { writeWorkspaceArtifacts } = await import(pathToFileURL(join(source, 'packages/typert/generator/src/artifact-files.ts')))
const generated = new WorkspaceTypertGenerator(source, { checkDiagnostics: false, rejectBuildOutputs: true })
  .generate(['@deepseek-ai/dsh-api-session-controller'], ['host'])
writeWorkspaceArtifacts(source, generated)

const work = mkdtempSync(join(tmpdir(), 'desktop-reader-build-'))
const before = join(work, 'before')
const after = join(work, 'after')
mkdirSync(before); mkdirSync(after)
const tarball = join(root, `vendor/dsh-runtime/${pin.sourceVersion}/deepseek-ai-dsh-api-session-controller-${pin.sourceVersion}.tgz`)
execFileSync('tar', ['-xzf', tarball, '-C', before])
cpSync(join(before, 'package'), join(after, 'package'), { recursive: true })
const packageSource = join(source, 'packages/api/session-controller')
const target = join(after, 'package')
// Keep the published metadata, locale, and client bundle byte-for-byte unchanged.
for (const name of readdirSync(join(packageSource, 'src')).filter(name => name.endsWith('.ts'))) {
  const text = readFileSync(join(packageSource, 'src', name), 'utf8')
  const result = ts.transpileModule(text, {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true },
    reportDiagnostics: true,
  })
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error(`Transpile failed: ${name}`)
  mkdirSync(join(target, 'lib/types'), { recursive: true })
  writeFileSync(join(target, 'lib/types', name.replace(/\.ts$/, '.js')), result.outputText)
}
for (const name of ['typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts']) {
  cpSync(join(packageSource, 'lib', name), join(target, 'lib', name))
}
// Reader declarations are required by generated remote-client types.
for (const name of ['types.ts', 'index.ts', 'history.ts', 'reader.ts']) {
  const result = ts.transpileDeclaration(readFileSync(join(packageSource, 'src', name), 'utf8'), {
    fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
  })
  writeFileSync(join(target, 'lib/types', name.replace(/\.ts$/, '.d.ts')), result.outputText)
}
await build({ config: false, entry: [join(target, 'lib/types/index.js')], outDir: join(target, 'lib'),
  platform: 'node', target: 'es2024', format: 'esm', outExtensions: () => ({ js: '.js' }), dts: false, clean: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/, /^mime-types$/, /^zod$/] },
})
// Strip only bundler region comments containing temporary build paths, for reproducible artifacts.
const bundlePath = join(target, 'lib/index.js')
writeFileSync(bundlePath, readFileSync(bundlePath, 'utf8').replace(/^\/\/#region .*\/package\/(lib\/types\/[^\n]+)$/gm, '//#region $1'))
const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--binary', 'before/package', 'after/package'],
  { cwd: work, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
if (![0, 1].includes(diff.status)) throw Error(diff.stderr)
const patch = diff.stdout.replaceAll('a/before/package/', 'a/').replaceAll('b/after/package/', 'b/')
  .replaceAll('a/after/package/', 'a/').replaceAll('b/before/package/', 'b/')
const patchPath = join(root, 'runtime-customizations/session-reader/package.patch')
writeFileSync(patchPath, patch)
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(root, 'runtime-customizations/session-reader/provenance.json'), JSON.stringify({
  sourceRepository: metadata.repository, sourceCommit: head, packageVersion: pin.sourceVersion,
  sourcePatchSha256: sha256(sourcePatch), publishedTarballSha256: sha256(tarball), generatedPatchSha256: sha256(patchPath),
  generatedContracts: generated.length,
}, null, 2) + '\n')
console.log(JSON.stringify({ patch: patchPath, builtPackage: target, originalPackage: join(before, 'package'), work }, null, 2))
