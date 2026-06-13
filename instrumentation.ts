export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { clearRegistry } = await import('./src/platform/core/registry')
    const { registerAllGames } = await import('./src/platform/core/register-games')
    clearRegistry()
    registerAllGames()
  }
}
