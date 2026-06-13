/**
 * Prompt Builder - Constructs system and user messages for LLM players
 */

import type { Player } from '../../../types/player'
import type { StructuredImpression } from '../../../types/player'
import type { GameState } from '../../../types/game'
import type { PlayerAction } from '../../../types/action'
import type { AvailableAction } from '../engine/poker-engine'
import { cardToString } from '../../../types/card'
import { getPositionByOffset } from './preflop-ranges'
import type { Position } from './preflop-ranges'

/**
 * Build the system message for an LLM player.
 */
export function buildSystemMessage(
  player: Player,
  gameState: GameState,
  impressions: Map<string, StructuredImpression> | undefined,
  otherPlayers: Player[],
): string {
  const name = player.name
  const systemPrompt = player.systemPrompt || '一个专业的德州扑克AI玩家'
  const smallBlind = gameState.smallBlind
  const bigBlind = gameState.bigBlind

  let impressionPart = ''
  if (otherPlayers.length > 0) {
    impressionPart = '\n\n## 各选手印象\n'
    for (const other of otherPlayers) {
      const imp = impressions?.get(other.id)
      if (imp && imp.handCount > 0) {
        impressionPart += `- ${other.name}: L=${imp.looseness.toFixed(1)} A=${imp.aggression.toFixed(1)} S=${imp.stickiness.toFixed(1)} H=${imp.honesty.toFixed(1)} | ${imp.note || '无备注'} (${imp.handCount}手观察)\n`
      } else {
        impressionPart += `- ${other.name}: 暂无印象\n`
      }
    }
    impressionPart += `\n维度说明: L=入池意愿(松紧) A=攻击性(激进/被动) S=抗弃牌(粘性) H=诚实度(诈唬倾向) 范围1-10`
  }

  return `你是 ${name}，${systemPrompt}。

## 游戏规则
- 6人桌有限注德州扑克（Fixed-Limit Hold'em, $${smallBlind}/$${bigBlind}）
- 小盲注 = $${smallBlind / 2}，大盲注 = $${smallBlind}
- 发牌流程: 翻前(底牌2张) → 翻牌(公共牌3张) → 转牌(+1张) → 河牌(+1张，共5张后不再发牌)
- 河牌后手牌已完全定型，不存在听牌，必须用现有7张牌组合最强5张
- 翻牌前和翻牌圈下注/加注固定为 $${smallBlind}（小注）
- 转牌和河牌圈下注/加注固定为 $${bigBlind}（大注）
- 每条街最多 4 次下注/加注（1bet + 3raise），封顶后只能跟注或弃牌
- 单挑时无加注次数限制
- 筹码不足时自动全下

## 位置
BTN(庄家) → SB(小盲) → BB(大盲) → UTG(枪口) → MP(中间) → CO(关煞)
翻前 UTG 先行动，翻后 SB 先行动

## 回复格式
先在 <thinking> 中简要分析（≤200字），再在 <action> 中给出操作名。
<thinking>分析过程</thinking>
<action>操作名</action>${impressionPart}`
}

/**
 * Compute active players sorted by seatIndex offset from dealer,
 * and return offset-based position for a given player.
 */
function getPlayerPosition(player: Player, gameState: GameState): Position {
  const activePlayers = gameState.players
    .filter(p => p.status !== 'sittingOut' && p.status !== 'eliminated')
    .sort((a, b) => {
      const offsetA = (a.seatIndex - gameState.dealerIndex + 6) % 6
      const offsetB = (b.seatIndex - gameState.dealerIndex + 6) % 6
      return offsetA - offsetB
    })
  const playerOffset = activePlayers.findIndex(p => p.id === player.id)
  return getPositionByOffset(playerOffset >= 0 ? playerOffset : 0, activePlayers.length)
}

/**
 * Build the decision request user message.
 */
export function buildDecisionRequest(
  player: Player,
  gameState: GameState,
  validActions: AvailableAction[],
): string {
  const holeCards = player.holeCards.map(c => cardToString(c)).join(' ')
  const position = getPlayerPosition(player, gameState)

  const positionNames: Record<string, string> = {
    BTN: '按钮位', SB: '小盲位', BB: '大盲位',
    UTG: '枪口位', MP: '中间位', CO: '关煞位',
  }

  const communityCards = gameState.communityCards.length > 0
    ? gameState.communityCards.map(c => cardToString(c)).join(' ')
    : '无'

  const phaseNames: Record<string, string> = {
    preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌',
  }

  // Phase-aware hint: tell LLM how many community cards remain
  const phaseHints: Record<string, string> = {
    preflop: '（公共牌尚未发出，接下来将发翻牌3张+转牌1张+河牌1张）',
    flop: '（翻牌已发3张，还将发转牌1张+河牌1张）',
    turn: '（转牌已发4张，还将发河牌最后1张）',
    river: '（河牌已发完全部5张公共牌，不会再发牌，你的手牌已定型，不存在听牌）',
  }
  const phaseHint = phaseHints[gameState.phase] || ''

  // Build action history by street
  const actionsByStreet = buildActionHistory(gameState)

  // Build valid actions list
  const actionsText = validActions.map(a => formatAction(a)).join('\n')

  // Build opponent info — Change 7b
  const opponentLines: string[] = []
  for (const p of gameState.players) {
    if (p.id === player.id) continue
    if (p.status === 'eliminated' || p.status === 'sittingOut') continue
    const pPos = getPlayerPosition(p, gameState)
    const statusText = p.status === 'folded' ? '已弃牌'
      : p.status === 'allIn' ? '全下'
      : ''
    opponentLines.push(`  - ${p.name} [${pPos}]: $${p.chips}${statusText ? ` (${statusText})` : ''}`)
  }
  const opponentInfo = opponentLines.length > 0
    ? `\n对手信息:\n${opponentLines.join('\n')}\n`
    : ''

  return `## 当前手牌 #${gameState.handNumber}
你的底牌: ${holeCards}
位置: ${position}（${positionNames[position] || position}）
筹码: $${player.chips}

公共牌: ${communityCards} (${phaseNames[gameState.phase] || gameState.phase}) ${phaseHint}
底池: $${gameState.pot}
${opponentInfo}
本手操作记录:
${actionsByStreet}

轮到你行动，可用操作:
${actionsText}

在 <action> 标签中输出操作名，如: <action>call</action>`
}

/**
 * Build the impression update request.
 */
export function buildImpressionRequest(
  _player: Player,
  handSummary: string,
  currentImpressions: Map<string, StructuredImpression> | undefined,
  otherPlayers: Player[],
): string {
  let impressionsList = ''
  for (const other of otherPlayers) {
    const imp = currentImpressions?.get(other.id)
    if (imp && imp.handCount > 0) {
      impressionsList += `- ${other.name}: L=${imp.looseness.toFixed(1)} A=${imp.aggression.toFixed(1)} S=${imp.stickiness.toFixed(1)} H=${imp.honesty.toFixed(1)} | ${imp.note || '无备注'} (${imp.handCount}手观察)\n`
    } else {
      impressionsList += `- ${other.name}: 暂无印象\n`
    }
  }

  const playerNames = otherPlayers.map(p => p.name)

  return `本局已结束。

${handSummary}

当前你对各选手的印象:
${impressionsList}
请基于本局可观察的行动轨迹，为每位选手评分并附备注（每人限30字内）。

4个维度（1-10分）:
- L (looseness 入池意愿): 1=极紧 10=极松
- A (aggression 攻击性): 1=被动 10=激进
- S (stickiness 抗弃牌): 1=容易弃牌 10=死不弃牌
- H (honesty 诚实度): 1=纯诈唬 10=从不诈唬

格式:
<scores>
${playerNames.map(name => `- ${name}: L=? A=? S=? H=? | 备注`).join('\n')}
</scores>`
}

/**
 * Build a hand summary for impression updates.
 */
export function buildHandSummary(gameState: GameState): string {
  const players = gameState.players.filter(p => p.status !== 'sittingOut' && p.status !== 'eliminated')

  let summary = `本局（手牌 #${gameState.handNumber}）各选手操作摘要:\n`
  for (const p of players) {
    const actions = gameState.actionHistory
      .filter(a => a.playerId === p.id)
      .map(a => formatPlayerAction(a, gameState))
    summary += `- ${p.name}: ${actions.join(', ') || '无操作'}\n`
  }

  return summary
}

// --- Helpers ---

function buildActionHistory(gameState: GameState): string {
  const phaseNames: Record<string, string> = {
    preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
  }

  const lines: string[] = []

  // List all actions in order with phase markers
  let currentPhase = ''
  for (const action of gameState.actionHistory) {
    const player = gameState.players.find(p => p.id === action.playerId)
    const playerName = player?.name || action.playerId
    // Use per-action phase if available, fallback to current game phase
    const actionPhase = action.phase || gameState.phase
    const phaseName = phaseNames[actionPhase] || actionPhase

    if (phaseName !== currentPhase) {
      currentPhase = phaseName
      lines.push(`- [${currentPhase}]`)
    }

    lines.push(`  ${playerName}: ${formatPlayerAction(action, gameState)}`)
  }

  return lines.length > 0 ? lines.join('\n') : '暂无'
}

function formatAction(action: AvailableAction): string {
  switch (action.type) {
    case 'fold': return '- fold — 弃牌，放弃本手'
    case 'check': return '- check — 过牌，不下注'
    case 'call': return `- call — 跟注 $${action.minAmount || 0}，匹配当前最高下注`
    case 'bet':
      return `- bet — 下注 $${action.minAmount || 0}（固定金额）`
    case 'raise':
      return `- raise — 加注到 $${action.minAmount || 0}（固定金额）`
    default:
      return `- ${action.type}`
  }
}

function formatPlayerAction(action: PlayerAction, gameState: GameState): string {
  void gameState
  switch (action.type) {
    case 'postSmallBlind': return `支付小盲注 $${action.amount}`
    case 'postBigBlind': return `支付大盲注 $${action.amount}`
    case 'fold': return '弃牌'
    case 'check': return '过牌'
    case 'call': return `跟注 $${action.amount}`
    case 'bet': return `下注 $${action.amount}`
    case 'raise': return `加注到 $${action.amount}`
    case 'allIn': return `全下 $${action.amount}`
    default: return action.type
  }
}
