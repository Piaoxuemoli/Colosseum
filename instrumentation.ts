export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { clearRegistry } = await import('./lib/core/registry')
    const { registerAllGames } = await import('./lib/core/register-games')
    clearRegistry()
    registerAllGames()
  }
}
