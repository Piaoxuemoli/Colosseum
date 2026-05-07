import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const { profileId } = await context.params
  await db.delete(apiProfiles).where(eq(apiProfiles.id, profileId))
  return new Response(null, { status: 204 })
}
