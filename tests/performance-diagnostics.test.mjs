import test from "node:test";
import assert from "node:assert/strict";
import { createPerformanceDiagnostics } from "../client/src/performance-diagnostics.js";

function fakeWindow(search) {
  let callback;
  let observer;
  const win = {
    location: { search },
    requestAnimationFrame(fn) { callback = fn; return 1; },
    cancelAnimationFrame() {},
    PerformanceObserver: class {
      constructor(fn) { observer = fn; }
      observe() {}
      disconnect() {}
    }
  };
  return {
    win,
    frame(time) { callback?.(time); },
    longTask(duration) { observer?.({ getEntries: () => [{ duration }] }); }
  };
}

test("performance diagnostics are disabled by default", () => {
  const { win } = fakeWindow("");
  assert.equal(createPerformanceDiagnostics(win), null);
});

test("diagnostics collect aggregate counts without user data", () => {
  const browser = fakeWindow("?kw_perf=1");
  const diagnostic = createPerformanceDiagnostics(browser.win);
  assert.ok(diagnostic);
  browser.frame(100);
  browser.frame(180);
  browser.longTask(87);
  diagnostic.recordRoomUpdate();
  const result = diagnostic.snapshot();
  assert.equal(result.longTaskCount, 1);
  assert.equal(result.longestTaskMs, 87);
  assert.equal(result.slowFrameCount, 1);
  assert.equal(result.slowestFrameMs, 80);
  assert.equal(result.roomUpdatesRecorded, 1);
  assert.deepEqual(Object.keys(result).sort(), [
    "longTaskCount", "longestTaskMs", "roomUpdatesLastMinute",
    "roomUpdatesRecorded", "slowFrameCount", "slowestFrameMs", "uptimeSeconds"
  ].sort());
  diagnostic.stop();
});

test("bounded samples do not undercount lifetime events", () => {
  const browser = fakeWindow("?kw_perf=1");
  const diagnostic = createPerformanceDiagnostics(browser.win);
  for (let i = 0; i < 240; i++) {
    diagnostic.recordRoomUpdate();
    browser.longTask(60);
    browser.frame(100 + i * 100);
  }
  const result = diagnostic.snapshot();
  assert.equal(result.roomUpdatesRecorded, 240);
  assert.equal(result.longTaskCount, 240);
  assert.equal(result.slowFrameCount, 239);
  diagnostic.stop();
});
