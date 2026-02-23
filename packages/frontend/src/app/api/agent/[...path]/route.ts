import { NextRequest, NextResponse } from 'next/server'

const isProd = process.env.NODE_ENV === 'production'

if (isProd && !process.env.AGENT_URL) {
  throw new Error('[Prophit] AGENT_URL is required in production')
}

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3001'
const AGENT_API_KEY = process.env.AGENT_API_KEY || ''

async function proxyRequest(req: NextRequest, path: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (AGENT_API_KEY) {
    headers['Authorization'] = `Bearer ${AGENT_API_KEY}`
  }

  const url = `${AGENT_URL}/api/${path}`
  const options: RequestInit = {
    method: req.method,
    headers,
  }
  if (req.method === 'POST') {
    options.body = await req.text()
  }

  const res = await fetch(url, options)
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  return proxyRequest(req, params.path.join('/'))
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  return proxyRequest(req, params.path.join('/'))
}
