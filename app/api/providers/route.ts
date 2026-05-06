import { PROVIDER_CATALOG } from '@/lib/llm/catalog'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  return Response.json(
    { providers: PROVIDER_CATALOG },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  )
}
