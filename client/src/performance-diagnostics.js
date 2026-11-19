// Opt-in, local-only battle performance diagnostics.
// Enable with ?kw_perf=1; read aggregate metrics via window.__KW_PERF__.snapshot().
// No player names, cards, room codes, tokens or network payloads are collected.
const MAX_SAMPLES = 180;
const bounded = (items, item) => {
  items.push(item);
  if (items.length > MAX_SAMPLES) items.shift();
};
export function createPerformanceDiagnostics(win = window) {
  const params = new URLSearchParams(win.location.search);
  if (params.get("kw_perf") !== "1") return null;
  const data = { longTasks: [], frames: [], socketUpdates: [], startedAt: Date.now() };
  let observer = null;
  let frameHandle = null;
  let lastFrame = 0;
  let active = true;
  const recordRoomUpdate = () => {
    if (active) bounded(data.socketUpdates, Date.now());
  };
  const frame = (time) => {
    if (!active) return;
    if (lastFrame && time - lastFrame > 50) bounded(data.frames, Math.round(time - lastFrame));
    lastFrame = time;
    frameHandle = win.requestAnimationFrame(frame);
  };
  if (typeof win.PerformanceObserver === "function") {
    try {
      observer = new win.PerformanceObserver((list) => {
        if (!active) return;
        for (const entry of list.getEntries()) bounded(data.longTasks, Math.round(entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch { /* unsupported browser */ }
  }
  if (typeof win.requestAnimationFrame === "function") frameHandle = win.requestAnimationFrame(frame);
  const snapshot = () => {
    const now = Date.now();
    const lastMinute = data.socketUpdates.filter(t => t >= now - 60000).length;
    const max = (values) => values.length ? Math.max(...values) : 0;
    return {
      uptimeSeconds: Math.round((now - data.startedAt) / 1000),
      longTaskCount: data.longTasks.length,
      longestTaskMs: max(data.longTasks),
      slowFrameCount: data.frames.length,
      slowestFrameMs: max(data.frames),
      roomUpdatesLastMinute: lastMinute,
      roomUpdatesRecorded: data.socketUpdates.length
    };
  };
  const stop = () => {
    active = false;
    observer?.disconnect();
    if (frameHandle != null && typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frameHandle);
  };
  return { snapshot, recordRoomUpdate, stop };
}
