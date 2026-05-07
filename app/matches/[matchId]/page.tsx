import { notFound } from 'next/navigation'
import { loadMatchSpectatorBundle } from '@/lib/match/load-spectator-bundle'
import { SpectatorView } from './SpectatorView'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const bundle = await loadMatchSpectatorBundle(matchId)
  if (!bundle) notFound()

  return (
    <SpectatorView
      matchId={matchId}
      gameType={bundle.match.gameType as 'poker' | 'werewolf'}
      initialPlayers={bundle.initialPlayers}
      initialEvents={bundle.initialEvents}
      initialChips={bundle.initialChips}
      status={bundle.match.status}
    />
  )
}
