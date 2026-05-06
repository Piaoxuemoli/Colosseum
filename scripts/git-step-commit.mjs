import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  })

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

function fail(message, detail = '') {
  console.error(`FAIL ${message}`)
  if (detail) console.error(detail)
  process.exit(1)
}

const message = process.argv.slice(2).join(' ').trim()
if (!message) {
  fail('commit message is required', 'Usage: npm run commit:step -- "feat(p0): add env loader"')
}

const status = run('git', ['status', '--porcelain'])
if (!status.ok) fail('git status failed', status.stderr)

if (!status.stdout) {
  console.log('SKIP commit: working tree is clean')
  process.exit(0)
}

const sensitivePatterns = [
  /(^|[/\\])\.env($|\.|[/\\])/,
  /(^|[/\\])old[/\\]ops[/\\]private[/\\]/,
  /\.(pem|key|p12|pfx)$/i,
  /(token|secret|credential|credentials|cookie).*\.(json|txt|md|env)$/i,
]

const allowedPatterns = [
  /(^|[/\\])\.env\.example$/,
]

const touchedFiles = status.stdout
  .split(/\r?\n/)
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
  .filter(Boolean)

const blocked = touchedFiles.filter((file) => {
  if (allowedPatterns.some((pattern) => pattern.test(file))) return false
  return sensitivePatterns.some((pattern) => pattern.test(file))
})

if (blocked.length > 0) {
  fail('sensitive-looking files are present; commit aborted', blocked.join('\n'))
}

const add = run('git', ['add', '-A'], { stdio: 'inherit' })
if (!add.ok) process.exit(add.status)

const whitespace = run('git', ['diff', '--cached', '--check'])
if (!whitespace.ok) fail('staged diff check failed', whitespace.stdout || whitespace.stderr)

const staged = run('git', ['diff', '--cached', '--name-status'])
if (staged.stdout) {
  console.log(staged.stdout)
}

const commit = run('git', ['commit', '-m', message], { stdio: 'inherit' })
if (!commit.ok) process.exit(commit.status)

const after = run('git', ['status', '--short', '--branch'])
if (after.stdout) console.log(after.stdout)
