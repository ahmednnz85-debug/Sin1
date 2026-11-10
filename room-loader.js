/* Sîn — Room streaming loader (Phase 2).
   Single-file queue, 3–4 ms/frame budget, 10 s / 2-hop unload hysteresis.
   Kill switch: ?roomloader=0 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    var params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    root.SinRoomLoader = params.get('roomloader') === '0' ? null : api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULTS = {
    sliceMs: 3.5,
    maxTasksPerFrame: 1,
    hysteresisHops: 2,
    hysteresisMs: 10000,
    cameraPauseRadPerSec: 1.35,
    doorPause: true
  };

  function createLoader(options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var queue = [];
    var busy = false;
    var done = 0;
    var skipped = 0;
    var lastSlice = 0;
    var peakSlice = 0;
    var leaveAt = new Map(); // id -> timestamp when first became cold candidate
    var paused = false;
    var pauseReason = null;
    var lastCam = null;
    var camOmega = 0;

    function now() {
      return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }
    function pending() { return queue.length + (busy ? 1 : 0); }

    function push(task, priority) {
      if (!task || typeof task.run !== 'function') return null;
      task.priority = priority === 0 || priority === 1 ? priority : 2;
      task.id = task.id || ('task-' + done + '-' + queue.length);
      // Deduplicate by id: keep the higher priority.
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].id === task.id) {
          if (task.priority < queue[i].priority) queue[i] = task;
          return queue[i];
        }
      }
      queue.push(task);
      queue.sort(function (a, b) { return a.priority - b.priority; });
      return task;
    }

    function setPaused(on, reason) {
      paused = !!on;
      pauseReason = on ? (reason || 'paused') : null;
    }

    function noteCamera(dirX, dirZ, dt) {
      var d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;
      if (!lastCam) { lastCam = { x: dirX, z: dirZ }; camOmega = 0; return camOmega; }
      var dot = Math.max(-1, Math.min(1, lastCam.x * dirX + lastCam.z * dirZ));
      var ang = Math.acos(dot);
      camOmega = ang / d;
      lastCam.x = dirX; lastCam.z = dirZ;
      return camOmega;
    }

    function shouldPause(info) {
      if (info && info.doorBusy && o.doorPause) return 'door';
      if (camOmega >= o.cameraPauseRadPerSec) return 'camera';
      if (info && info.forcePause) return info.forcePause;
      return null;
    }

    function runFrame(frameNow, info) {
      var t0 = Number.isFinite(frameNow) ? frameNow : now();
      var reason = shouldPause(info);
      setPaused(!!reason, reason);
      if (paused || busy || !queue.length) {
        return { ran: 0, sliceMs: 0, pending: pending(), paused: paused, reason: pauseReason };
      }
      var task = queue.shift();
      busy = true;
      var started = now();
      var finished = function () {
        busy = false;
        done++;
        lastSlice = now() - started;
        if (lastSlice > peakSlice) peakSlice = lastSlice;
      };
      try {
        var result = task.run();
        if (result && typeof result.then === 'function') {
          result.then(finished, finished);
        } else {
          finished();
        }
      } catch (e) {
        finished();
        skipped++;
      }
      // Soft budget: if the sync work itself overran, skip further tasks this frame.
      var used = now() - t0;
      lastSlice = Math.max(lastSlice, used);
      return { ran: 1, sliceMs: +used.toFixed(2), pending: pending(), paused: false, reason: null };
    }

    /* Keep rooms that are still within hysteresis of the active set. */
    function applyHysteresis(residentSet, hopMap, frameNow) {
      var t = Number.isFinite(frameNow) ? frameNow : now();
      var keep = residentSet instanceof Set ? new Set(residentSet) : new Set(residentSet || []);
      var hops = hopMap instanceof Map ? hopMap : new Map();
      // Mark leave times for rooms that fell outside the live resident set.
      hops.forEach(function (h, id) {
        if (keep.has(id)) { leaveAt.delete(id); return; }
        if (h < o.hysteresisHops) { leaveAt.delete(id); keep.add(id); return; }
        if (!leaveAt.has(id)) leaveAt.set(id, t);
        if (t - leaveAt.get(id) < o.hysteresisMs) keep.add(id);
        else leaveAt.delete(id);
      });
      // Also retain ids that left the hop map entirely but still linger.
      Array.from(leaveAt.keys()).forEach(function (id) {
        if (keep.has(id)) return;
        if (t - leaveAt.get(id) < o.hysteresisMs) keep.add(id);
        else leaveAt.delete(id);
      });
      return keep;
    }

    function report() {
      return {
        pending: pending(),
        done: done,
        skipped: skipped,
        lastSliceMs: +lastSlice.toFixed(2),
        peakSliceMs: +peakSlice.toFixed(2),
        paused: paused,
        reason: pauseReason,
        camOmega: +camOmega.toFixed(3),
        hysteresis: { hops: o.hysteresisHops, ms: o.hysteresisMs, lingering: leaveAt.size },
        sliceMs: o.sliceMs
      };
    }

    function reset() {
      queue.length = 0;
      busy = false;
      done = skipped = 0;
      lastSlice = peakSlice = 0;
      leaveAt.clear();
      paused = false;
      pauseReason = null;
      lastCam = null;
      camOmega = 0;
    }

    return {
      push: push,
      runFrame: runFrame,
      pending: pending,
      applyHysteresis: applyHysteresis,
      noteCamera: noteCamera,
      setPaused: setPaused,
      report: report,
      reset: reset,
      options: o
    };
  }

  return { createLoader: createLoader, DEFAULTS: DEFAULTS };
});
