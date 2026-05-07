import { notFound } from 'next/navigation'
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
