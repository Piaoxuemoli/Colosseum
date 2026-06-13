import { NextResponse } from 'next/server'
import { snapshot } from '@/platform/telemetry/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return NextResponse.json(snapshot())
}
