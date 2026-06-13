import { desc } from 'drizzle-orm'
import { Card, CardContent } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { ProfileForm } from '@/frontend/components/forms/ProfileForm'
import { ProfileRowActions } from '@/frontend/components/forms/ProfileRowActions'
import { db } from '@/platform/db/client'
import { apiProfiles } from '@/platform/db/schema.sqlite'

export const dynamic = 'force-dynamic'

export default async function ProfilesPage() {
  const rows = await db.select().from(apiProfiles).orderBy(desc(apiProfiles.createdAt))

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Local Key Control</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">API Profiles</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Profile 只保存 baseUrl 和模型名；API Key 只留在当前浏览器 localStorage。
          </p>
        </div>
        <ProfileForm />
      </div>

      {rows.length === 0 ? (
        <Empty
          title="暂无 API Profile"
          description="Profile 只保存 provider / baseUrl / 模型信息;API Key 只留在当前浏览器 localStorage 里,不会上送到服务端。"
        />
      ) : (
        <div className="space-y-3">
          {rows.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-white">{profile.displayName}</div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{profile.baseUrl}</div>
                </div>
                <ProfileRowActions
                  profileId={profile.id}
                  baseUrl={profile.baseUrl}
                  model={profile.model}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
