import { eq } from 'drizzle-orm'
import { findAgentById } from '@/lib/db/queries/agents'
import { db } from '@/lib/db/client'
import { agents } from '@/lib/db/schema.sqlite'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const agent = await findAgentById(agentId)
  if (!agent) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(agent)
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  await db.delete(agents).where(eq(agents.id, agentId))
  return new Response(null, { status: 204 })
}
