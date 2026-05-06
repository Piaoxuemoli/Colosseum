import { spawnSync } from 'node:child_process'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('==> Syncing git branch when safe')
run('npm', ['run', 'sync'])

console.log('==> Installing dependencies from lockfile')
run('npm', ['ci'])

console.log('==> Running environment doctor')
run('npm', ['run', 'doctor'])

console.log('==> Bootstrap complete')
