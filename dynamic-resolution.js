/* Frame-rate governor for render resolution only. */
(function (root) {
  'use strict';
  function create(options) {
    options = options || {};
    var min = Number.isFinite(options.min) ? options.min : 0.58;
    var max = Number.isFinite(options.max) ? options.max : 1.00;
    var down = Number.isFinite(options.downStep) ? options.downStep : 0.08;
    var up = Number.isFinite(options.upStep) ? options.upStep : 0.01;
    var lowerFps = Number.isFinite(options.lowerFps) ? options.lowerFps : 52;
    var upperFps = Number.isFinite(options.upperFps) ? options.upperFps : 58;
    var recoveryNeeded = Number.isFinite(options.recoveryMs) ? options.recoveryMs : 3000;
    var value = Math.max(min, Math.min(max, Number.isFinite(options.initial) ? options.initial : max));
    var recoveryMs = 0;

    function sample(fps, elapsedMs, busy, hint) {
      var before = value;
      if (busy || !Number.isFinite(fps) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
        recoveryMs = 0;
        return { value: value, changed: false };
      }
      // Memory pressure (from the zone streamer) is a second signal: under
      // critical GPU residency, drop scale the same way a slow frame would,
      // then recover with the same 3 s hysteresis so it does not flicker.
      var mem = hint && hint.memoryLevel;
      var heavyMem = mem === 'critical';
      if (fps < lowerFps || heavyMem) {
        recoveryMs = 0;
        value = Math.max(min, value - down);
      } else if (fps > upperFps && mem !== 'watch') {
        recoveryMs += elapsedMs;
        if (recoveryMs >= recoveryNeeded) {
          var steps = Math.floor(recoveryMs / recoveryNeeded);
          recoveryMs -= steps * recoveryNeeded;
          value = Math.min(max, value + up * steps);
        }
      } else {
        recoveryMs = 0;
      }
      // When the drawn triangle budget is modest, keep resolution readable on
      // phones (palace hall / single room) instead of lingering near min 0.58.
      var tris = hint && Number(hint.triangles);
      if (Number.isFinite(tris) && tris > 0 && tris < 600000) {
        value = Math.max(value, 0.85);
      }
      value = Math.round(value * 1000) / 1000;
      return { value: value, changed: value !== before };
    }

    return { sample: sample, value: function () { return value; }, reset: function (next) {
      value = Math.max(min, Math.min(max, Number.isFinite(next) ? next : max));
      recoveryMs = 0;
      return value;
    } };
  }
  root.SinDynamicResolution = { create: create };
})(window);
