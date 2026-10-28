import { NextResponse } from "next/server";
import { runAllJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// Vercel Cron sends Authorization: Bearer $CRON_SECRET. The route stays closed until that variable is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ results: await runAllJobs() });
}

export const POST = GET;
