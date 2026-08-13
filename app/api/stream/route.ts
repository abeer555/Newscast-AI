import { bus, BusEvent } from "@/lib/bus";

export const dynamic = "force-dynamic";

/** Global SSE stream: pipeline events + per-episode progress. */
export function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      };

      const onEvent = (e: BusEvent) => send("log", e);
      const onEpisode = (e: unknown) => send("episode", e);
      const onModelApi = (e: unknown) => send("model_api", e);
      const keepalive = setInterval(() => send("ping", { at: Date.now() }), 15000);

      bus().on("event", onEvent);
      bus().on("episode", onEpisode);
      bus().on("model_api", onModelApi);

      send("hello", { at: Date.now() });
      return () => {
        closed = true;
        clearInterval(keepalive);
        bus().off("event", onEvent);
        bus().off("episode", onEpisode);
        bus().off("model_api", onModelApi);
      };
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
