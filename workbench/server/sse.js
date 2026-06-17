// Server-Sent Events hub. One channel per runId. Events are buffered (capped) so
// a late or reconnecting subscriber can replay the run; a channel is dropped a
// few minutes after the run ends. Writes to dead clients are caught and the
// client pruned — a single stale socket must never crash the process.

const MAX_BUFFER = 1000;
const CHANNEL_TTL_MS = 5 * 60_000;

const channels = new Map(); // runId -> { buffer:[{event,data}], clients:Set<res>, closed }

function channel(runId) {
  let ch = channels.get(runId);
  if (!ch) {
    ch = { buffer: [], clients: new Set(), closed: false };
    channels.set(runId, ch);
  }
  return ch;
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function subscribe(runId, res) {
  const ch = channel(runId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  for (const e of ch.buffer) write(res, e.event, e.data);
  if (ch.closed) {
    res.end();
    return;
  }
  ch.clients.add(res);
  res.on("close", () => ch.clients.delete(res));
}

// Send to every client via `send` (returns false on a dead socket), pruning the dead.
function pruneDead(ch, send) {
  const dead = [];
  for (const res of ch.clients) {
    if (!send(res)) dead.push(res);
  }
  for (const res of dead) ch.clients.delete(res);
}

export function publish(runId, event, data) {
  const ch = channel(runId);
  ch.buffer.push({ event, data });
  if (ch.buffer.length > MAX_BUFFER) ch.buffer.shift();
  pruneDead(ch, (res) => write(res, event, data));
}

export function closeChannel(runId) {
  const ch = channels.get(runId);
  if (!ch) return;
  ch.closed = true;
  for (const res of ch.clients) {
    try {
      res.end();
    } catch {
      // already closed
    }
  }
  ch.clients.clear();
  // Keep the buffer briefly so a late/reconnecting client can still replay, then drop.
  setTimeout(() => channels.delete(runId), CHANNEL_TTL_MS).unref();
}

// Comment-line heartbeat keeps idle SSE connections (and proxies) alive. Dead
// clients are pruned so the next tick doesn't keep hitting them.
export function pingAll() {
  for (const ch of channels.values()) {
    pruneDead(ch, (res) => {
      try {
        res.write(": ping\n\n");
        return true;
      } catch {
        return false;
      }
    });
  }
}
