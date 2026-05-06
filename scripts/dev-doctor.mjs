import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

function check(label, fn) {
  try {
    const result = fn()
    if (result.ok) {
      console.log(`OK ${label}${result.detail ? `: ${result.detail}` : ''}`)
      return true
    }
    console.log(`FAIL ${label}${result.detail ? `: ${result.detail}` : ''}`)
    return false
  } catch (error) {
    console.log(`FAIL ${label}: ${String(error)}`)
    return false
  }
}

function warn(label, fn) {
  try {
    const result = fn()
    if (result.ok) {
      console.log(`OK ${label}${result.detail ? `: ${result.detail}` : ''}`)
      return true
    }
    console.log(`WARN ${label}${result.detail ? `: ${result.detail}` : ''}`)
    return true
  } catch (error) {
    console.log(`WARN ${label}: ${String(error)}`)
    return true
  }
}

const checks = []

checks.push(check('Node.js >= 22', () => {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  return {
    ok: major >= 22,
    detail: process.version,
  }
}))

checks.push(check('npm available', () => {
  const npm = run('npm', ['--version'])
  return { ok: npm.ok, detail: npm.stdout || npm.stderr }
}))

checks.push(check('Git available', () => {
  const git = run('git', ['--version'])
  return { ok: git.ok, detail: git.stdout || git.stderr }
}))

checks.push(check('package-lock.json present', () => ({
  ok: existsSync('package-lock.json'),
  detail: existsSync('package-lock.json') ? 'lockfile found' : 'run `npm install` first',
})))

checks.push(check('node_modules present', () => ({
  ok: existsSync('node_modules'),
  detail: existsSync('node_modules') ? 'dependencies installed' : 'run `npm ci` or `npm install`',
})))

checks.push(check('.env status', () => ({
  ok: existsSync('.env') || existsSync('.env.local') || existsSync('.env.example'),
  detail: existsSync('.env') || existsSync('.env.local')
    ? 'local env file found'
    : '.env.example found; copy it to .env when running services',
})))

checks.push(check('TypeScript compiler', () => {
  const tsc = run('npx', ['tsc', '--version'])
  return { ok: tsc.ok, detail: tsc.stdout || tsc.stderr }
}))

checks.push(warn('Docker available', () => {
  const docker = run('docker', ['--version'])
  return { ok: docker.ok, detail: docker.stdout || docker.stderr || 'optional until infra tasks' }
}))

checks.push(warn('Docker Compose available', () => {
  const compose = run('docker', ['compose', 'version'])
  return { ok: compose.ok, detail: compose.stdout || compose.stderr || 'optional until infra tasks' }
}))

const failed = checks.filter((ok) => !ok).length
if (failed > 0) {
  console.log(`\n${failed} environment check(s) failed.`)
  process.exit(1)
}

console.log('\nAll environment checks passed.')
