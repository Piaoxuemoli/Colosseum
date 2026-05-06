import { useAppStore } from '../store/app-store'
import type { GameType } from '../store/app-store'
import { Navbar } from '../components/layout/Navbar'

const GAMES: { type: GameType; name: string; icon: string; desc: string; players: string }[] = [
  {
    type: 'poker',
    name: '德州扑克',
    icon: 'casino',
    desc: '经典 6-max 无限注德州扑克，让 AI 大模型自主对弈或你亲自上场。',
    players: '2-6 人',
  },
  {
    type: 'doudizhu',
    name: '斗地主',
    icon: 'playing_cards',
    desc: '经典三人斗地主，地主 vs 农民，AI 智能出牌与配合。',
    players: '3 人',
  },
]

export function LobbyPage() {
  const { navigateToGame } = useAppStore()

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black font-headline text-on-surface mb-3">
            选择游戏
          </h1>
          <p className="text-on-surface-variant text-sm">
            选择一个游戏开始 AI 对战
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {GAMES.map((game) => (
            <button
              key={game.type}
              onClick={() => navigateToGame(game.type, 'setup')}
              className="group bg-surface-container-low hover:bg-surface-container rounded-2xl p-8 text-left transition-all duration-300 hover:shadow-lg hover:scale-[1.02] border border-transparent hover:border-primary/20 cursor-pointer"
            >
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <span className="material-symbols-outlined text-3xl text-primary">
                    {game.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold font-headline text-on-surface mb-2">
                    {game.name}
                  </h2>
                  <p className="text-sm text-on-surface-variant leading-relaxed mb-4">
                    {game.desc}
                  </p>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-primary bg-primary/10 px-3 py-1 rounded-full">
                      {game.players}
                    </span>
                    <span className="text-xs text-on-surface-variant/60 group-hover:text-primary transition-colors flex items-center gap-1">
                      点击进入
                      <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
