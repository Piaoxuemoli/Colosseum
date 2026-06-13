/**
 * 对局快照服务 — 保存/加载/删除快照，用于断线重连
 */
import { db } from './database'
import type { GameSnapshotRecord } from './database'

/** 保存对局快照（覆盖同 sessionId 的旧快照） */
export async function saveGameSnapshot(snapshot: GameSnapshotRecord): Promise<void> {
  await db.gameSnapshots.put(snapshot)
}

/** 加载最新的对局快照（按时间倒序取第一条） */
export async function loadLatestSnapshot(): Promise<GameSnapshotRecord | null> {
  const snapshot = await db.gameSnapshots
    .orderBy('timestamp')
    .reverse()
    .first()
  return snapshot ?? null
}

/** 删除指定 session 的快照 */
export async function deleteGameSnapshot(sessionId: string): Promise<void> {
  await db.gameSnapshots.delete(sessionId)
}
