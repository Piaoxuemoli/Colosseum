import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    shell: process.platform === 'win32',
  })

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

function printResult(label, result) {
  if (result.ok) {
    console.log(`OK ${label}`)
    return
  }
  console.log(`WARN ${label}`)
  if (result.stderr) console.log(result.stderr)
}

const insideRepo = run('git', ['rev-parse', '--is-inside-work-tree'])
if (!insideRepo.ok || insideRepo.stdout !== 'true') {
  console.log('SKIP git sync: not inside a git work tree')
  process.exit(0)
}

const status = run('git', ['status', '--porcelain'])
if (!status.ok) {
  printResult('git status failed', status)
  process.exit(status.status)
}

if (status.stdout.length > 0) {
  console.log('SKIP git pull: working tree is not clean')
  console.log('Run `git status --short` and commit/stash local work before syncing.')
  process.exit(0)
}

const upstream = run('git', [
  'rev-parse',
  '--abbrev-ref',
  '--symbolic-full-name',
  '@{u}',
])

if (!upstream.ok) {
  console.log('SKIP git pull: current branch has no upstream')
  console.log('If this is a fresh clone, set upstream once outside this script.')
  process.exit(0)
}

const fetch = run('git', ['fetch', '--all', '--prune'], { stdio: 'inherit' })
if (!fetch.ok) process.exit(fetch.status)

const pull = run('git', ['pull', '--ff-only'], { stdio: 'inherit' })
if (!pull.ok) process.exit(pull.status)

console.log(`OK synced with ${upstream.stdout}`)
