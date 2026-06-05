import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('deployment entrypoint script', () => {
  it('uses LF line endings so Alpine can execute the shebang', () => {
    const script = readFileSync(join(process.cwd(), 'ops/deploy/entrypoint.sh'), 'utf8')

    expect(script).not.toContain('\r\n')
  })
})
