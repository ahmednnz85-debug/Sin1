/* Frame-rate governor for render resolution only. */
(function (root) {
  'use strict';
  function create(options) {
    options = options || {};
    var min = Number.isFinite(options.min) ? options.min : 0.55;
    var max = Number.isFinite(options.max) ? options.max : 0.80;
    var down = Number.isFinite(options.downStep) ? options.downStep : 0.04;
    var up = Number.isFinite(options.upStep) ? options.upStep : 0.02;
    var lowerFps = Number.isFinite(options.lowerFps) ? options.lowerFps : 52;
    var upperFps = Number.isFinite(options.upperFps) ? options.upperFps : 58;
    var recoveryNeeded = Number.isFinite(options.recoveryMs) ? options.recoveryMs : 3000;
    var value = Math.max(min, Math.min(max, Number.isFinite(options.initial) ? options.initial : max));
    var recoveryMs = 0;

    function sample(fps, elapsedMs, busy) {
      var before = value;
      if (busy || !Number.isFinite(fps) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
        recoveryMs = 0;
        return { value: value, changed: false };
      }
      if (fps < lowerFps) {
        recoveryMs = 0;
        value = Math.max(min, value - down);
      } else if (fps > upperFps) {
        recoveryMs += elapsedMs;
        if (recoveryMs >= recoveryNeeded) {
          var steps = Math.floor(recoveryMs / recoveryNeeded);
          recoveryMs -= steps * recoveryNeeded;
          value = Math.min(max, value + up * steps);
        }
      } else {
        recoveryMs = 0;
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
