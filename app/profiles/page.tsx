import { desc } from 'drizzle-orm'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileForm } from '@/components/forms/ProfileForm'
import { ProfileRowActions } from '@/components/forms/ProfileRowActions'
import { db } from '@/lib/db/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'

export const dynamic = 'force-dynamic'

export default async function ProfilesPage() {
  const rows = await db.select().from(apiProfiles).orderBy(desc(apiProfiles.createdAt))

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Local Key Control</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">API Profiles</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Profile 只保存 provider、baseUrl 和模型信息；API Key 只留在当前浏览器 localStorage。
          </p>
        </div>
        <ProfileForm />
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-sm text-muted-foreground">暂无 Profile。新增一个 provider 后再创建 Agent。</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-white">{profile.displayName}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {profile.providerId} · {profile.model}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-cyan-100/65">{profile.baseUrl}</div>
                </div>
                <ProfileRowActions profileId={profile.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
