/**
 * SSE stream of render-job progress. The workspace subscribes to this so the
 * UI updates without polling. Emits NDJSON lines (matches the convention used
 * by /api/generate-shot — same client-side parser).
 *
 * Strategy: poll the row every 1s server-side, push diff lines whenever
 * status/progress/output_url changes. Closes when the job is terminal.
 *
 * On Vercel free tier the stream is bounded by `maxDuration` — generous
 * enough to outlast a SeaDance render (≈30-90s typical).
 */

import { type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const TERMINAL = new Set(["done", "error", "canceled"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("supabase not configured", { status: 503 });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("unauthorized", { status: 401 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;

      // Wrap enqueue so a client-side disconnect (which causes enqueue to
      // throw "Invalid state: Controller is already closed") flips a flag
      // and lets the polling loop bail out instead of churning for 15 min.
      const send = (obj: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      let lastHash = "";
      let elapsed = 0;
      const TICK_MS = 1000;
      const MAX_MS = 15 * 60_000; // 15 minutes hard ceiling

      try {
        while (elapsed < MAX_MS && !closed) {
          const { data: job, error } = await supabase
            .from("render_jobs")
            .select("id, status, progress, output_url, error, finished_at")
            .eq("id", id)
            .maybeSingle();

          if (error) {
            send({ type: "error", message: error.message });
            break;
          }
          if (!job) {
            send({ type: "error", message: "job not found" });
            break;
          }

          const hash = `${job.status}|${job.progress}|${job.output_url ?? ""}`;
          if (hash !== lastHash) {
            if (!send({
              type: "tick",
              status: job.status,
              progress: job.progress,
              output_url: job.output_url,
              error: job.error,
            })) break;
            lastHash = hash;
          }

          if (TERMINAL.has(job.status)) {
            send({ type: "done", status: job.status, output_url: job.output_url, error: job.error });
            break;
          }

          await sleep(TICK_MS);
          elapsed += TICK_MS;
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed by the runtime */
          }
        }
      }
    },
    cancel() {
      // Browser closed the connection. The polling loop's `closed` flag is
      // checked at the top of every iteration and after every send, so
      // marking the controller closed via the local flag isn't strictly
      // necessary — but the explicit cancel hook makes the intent visible.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
