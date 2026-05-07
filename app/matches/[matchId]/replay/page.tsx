import { notFound, redirect } from 'next/navigation'
import { loadMatchSpectatorBundle } from '@/lib/match/load-spectator-bundle'
import { ReplayView } from './ReplayView'

export const dynamic = 'force-dynamic'

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const { matchId } = await params
  const bundle = await loadMatchSpectatorBundle(matchId)
  if (!bundle) notFound()

  // Don't let a user replay a live match — the event log is still growing, the
  // frozen snapshot would look complete but is not. Bounce back to the live
  // spectator view instead.
  if (bundle.match.status === 'running') {
    redirect(`/matches/${matchId}`)
  }

  return (
    <ReplayView
      matchId={matchId}
      gameType={bundle.match.gameType as 'poker' | 'werewolf'}
      initialPlayers={bundle.initialPlayers}
      events={bundle.initialEvents}
      initialChips={bundle.initialChips}
      totalEvents={bundle.initialEvents.length}
    />
  )
}
