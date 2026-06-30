import { NextResponse } from "next/server";
import { loadCompetitionStandings } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Polling endpoint (every 15–30 s) for live competition-aggregated standings. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const code = new URL(req.url).searchParams.get("code");
  try {
    const data = await loadCompetitionStandings(id, code);
    if (!data) return NextResponse.json({ error: "Competition not found" }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
