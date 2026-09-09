import { NextResponse } from 'next/server';
export function GET() {
  return NextResponse.json({ status: 'ok', version: process.env.DEPLOYED_SHA ?? 'development' });
}
