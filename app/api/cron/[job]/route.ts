import { NextResponse } from "next/server";
import { JOBS, runJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// One job by name, for schedules that differ from the daily batch (e.g. nightly interest accrual in B4).
export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { job } = await params;
  if (!JOBS[job]) return NextResponse.json({ error: `No job named ${job}` }, { status: 404 });
  return NextResponse.json(await runJob(job));
}

export const POST = GET;
