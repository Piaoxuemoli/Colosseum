/**
 * 德扑 A2UI 清单：登记可用 surface + catalog 绑定（spec D6，供未来多 surface 扩展）。
 */
import type { A2UIManifest } from '@/platform/core/a2ui-types'

export const pokerConfigManifest: A2UIManifest = {
  catalogId: 'colosseum-basic',
  surfaces: ['poker-match-config'],
}
