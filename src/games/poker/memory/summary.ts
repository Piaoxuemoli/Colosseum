import type { PokerEpisodicEntry } from './episodic'
import type { PokerSemanticProfile } from './semantic'

export type ImpressionSummaryInput = {
  targetName: string
  observerName?: string
  profile: PokerSemanticProfile
  recentEpisodes: PokerEpisodicEntry[]
}

function scoreWord(value: number, low = 3.5, high = 6.5): { level: string; direction: string } {
  if (value <= low) return { level: '低', direction: '偏紧/保守' }
  if (value >= high) return { level: '高', direction: '偏松/激进' }
  return { level: '中等', direction: '均衡' }
}

function traitSentence(label: string, value: number, low = 3.5, high = 6.5): string {
  const { level } = scoreWord(value, low, high)
  return `${label}${level}（${value.toFixed(1)}）`
}

function trendFromEpisodes(episodes: PokerEpisodicEntry[]): string {
  if (episodes.length === 0) return '近期暂无具体对局记录。'

  const recent = episodes.slice(-3)
  const parts = recent.map((ep) => {
    const actions = ep.observedActions.join('、') || '无行动'
    const outcomeText =
      ep.outcome === 'won'
        ? '并赢得底池'
        : ep.outcome === 'folded'
          ? '最终弃牌'
          : ep.outcome === 'showdown'
            ? '坚持到摊牌'
            : '未能拿下底池'
    return `第${ep.handId.split(':hand:').pop() ?? '?'}手：${actions}，${outcomeText}`
  })

  return `最近记录：${parts.join('；')}。`
}

export function generateImpressionParagraph(input: ImpressionSummaryInput): string {
  const { targetName, observerName, profile, recentEpisodes } = input
  const observed = Math.max(1, profile.handCount)
  const perspective = observerName ? `${observerName} 看来，` : ''

  const looseness = traitSentence('松紧度', profile.looseness)
  const aggression = traitSentence('进攻性', profile.aggression)
  const stickiness = traitSentence('粘池倾向', profile.stickiness)
  const honesty = traitSentence('诚实度', profile.honesty)

  const looseWord = scoreWord(profile.looseness).direction.replace('偏紧/保守', '偏紧').replace('偏松/激进', '偏松')
  const aggroWord =
    profile.aggression >= 6.5 ? '激进' : profile.aggression <= 3.5 ? '被动' : '攻守均衡'
  const stickyWord = profile.stickiness >= 6.5 ? '喜欢在听牌或未成型牌上跟注到底' : '懂得在不利时弃牌止损'

  const trend = trendFromEpisodes(recentEpisodes)

  return `在 ${observed} 手观察中，${perspective}${targetName} 给人的印象是${looseWord}且${aggroWord}的选手。${looseness}，${aggression}，${stickiness}，${honesty}。${stickyWord}。${trend}`
}
