import { NextRequest, NextResponse } from "next/server";
import { writeStoryboard } from "@/lib/gemini-writer";
import type { AspectRatio } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      concept?: string;
      aspect?: AspectRatio | null;
      shots?: number;
      imageUrl?: string | null;
    };

    if (!body.concept || typeof body.concept !== "string") {
      return NextResponse.json({ error: "concept is required" }, { status: 400 });
    }

    const board = await writeStoryboard({
      concept: body.concept,
      aspectHint: body.aspect ?? null,
      maxShots: Math.min(Math.max(body.shots ?? 3, 1), 4),
    });

    if (body.imageUrl) {
      for (const s of board.shots) s.image_url = body.imageUrl;
    }

    return NextResponse.json({ storyboard: board });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
