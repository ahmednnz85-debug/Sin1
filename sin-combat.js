/* Shared combat rules. World/animation adapters provide poses and contact points. */
(function (root) {
  'use strict';

  const RULES = Object.freeze({
    hero: { health: 100, posture: 100, recovery: 28 },
    parryWindow: 0.16, guardArc: Math.cos(68 * Math.PI / 180), guardDamage: 0.18,
    postureDelay: 2.1, tick: 1 / 120, maxTicks: 12
  });
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  function createVitals({ health, posture, recovery }) {
    const state = { health, posture: 0, quiet: 0, broken: false };
    return {
      maximum: health, postureMaximum: posture, state,
      reset(value = health) {
        state.health = Number.isFinite(value) ? clamp(value, health) : health;
        state.posture = 0;
        state.quiet = 0;
        state.broken = false;
      },
      damage(amount) { state.health = clamp(state.health - amount, health); },
      pressure(amount) {
        if (!(amount > 0) || state.broken) return false;
        state.quiet = RULES.postureDelay;
        state.posture = clamp(state.posture + amount, posture);
        state.broken = state.posture >= posture;
        return state.broken;
      },
      recover(fraction = 0) {
        state.broken = false;
        state.posture = posture * fraction;
        state.quiet = RULES.postureDelay;
      },
      step(dt) {
        state.quiet = Math.max(0, state.quiet - dt);
        if (state.quiet <= 0 && !state.broken) state.posture = clamp(state.posture - recovery * dt, posture);
      }
    };
  }

  function resolveDamage(vitals, attack, defense, contact) {
    if (!vitals.state.health || defense.invulnerable || !contact) return null;
    const guard = defense.blocking && defense.alignment >= RULES.guardArc && attack.blockable !== false;
    if (guard && attack.parryable !== false && defense.guardAge <= RULES.parryWindow) {
      return { kind: 'parry', damage: 0, broken: false, point: contact };
    }
    const broken = vitals.pressure(guard ? attack.posture : (attack.pressure || 0));
    const amount = attack.damage * (guard && !broken ? RULES.guardDamage : 1) * (defense.multiplier || 1);
    const previous = vitals.state.health;
    vitals.damage(amount);
    return {
      kind: broken ? 'break' : guard ? 'block' : attack.type || 'normal',
      damage: previous - vitals.state.health,
      broken, killed: !vitals.state.health, point: contact
    };
  }

  // Closest points on two finite segments (the second segment may be a sphere centre).
  function segments(ax, ay, az, bx, by, bz, c, d, radius, out) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
    const x = ax - c.x, y = ay - c.y, z = az - c.z;
    const a = ux * ux + uy * uy + uz * uz;
    const b = ux * vx + uy * vy + uz * vz;
    const e = vx * vx + vy * vy + vz * vz;
    const f = vx * x + vy * y + vz * z;
    const g = ux * x + uy * y + uz * z;
    const denom = a * e - b * b;
    let s = denom > 1e-10 ? clamp((b * f - g * e) / denom, 1) : 0;
    let t = e > 1e-10 ? (b * s + f) / e : 0;
    if (t < 0 || t > 1 || e <= 1e-10) {
      t = clamp(t, 1);
      s = a > 1e-10 ? clamp((b * t - g) / a, 1) : 0;
    }
    const px = x + ux * s - vx * t, py = y + uy * s - vy * t, pz = z + uz * s - vz * t;
    if (px * px + py * py + pz * pz > radius * radius) return false;
    out.x = ax + ux * s; out.y = ay + uy * s; out.z = az + uz * s;
    return true;
  }

  // Sweep five points along the weapon and test both end poses. At 120 Hz this
  // keeps the swept cross-section of a rotating blade covered without allocations.
  function sweep(a0, b0, a1, b1, weaponRadius, volumes, out) {
    for (const volume of volumes) {
      const c = volume.a, d = volume.b, r = volume.radius + weaponRadius;
      if (segments(a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, c, d, r, out) ||
          segments(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, c, d, r, out)) return volume;
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        const ax = a0.x + (b0.x - a0.x) * f, ay = a0.y + (b0.y - a0.y) * f, az = a0.z + (b0.z - a0.z) * f;
        const bx = a1.x + (b1.x - a1.x) * f, by = a1.y + (b1.y - a1.y) * f, bz = a1.z + (b1.z - a1.z) * f;
        if (segments(ax, ay, az, bx, by, bz, c, d, r, out)) return volume;
      }
    }
    return null;
  }

  function clock(step) {
    let pending = 0;
    return {
      advance(dt) {
        pending += Math.min(Math.max(0, dt), RULES.tick * RULES.maxTicks);
        while (pending + 1e-9 >= RULES.tick) {
          pending -= RULES.tick;
          step(RULES.tick);
        }
      },
      single() { step(RULES.tick); },
      reset() { pending = 0; }
    };
  }

  const api = { RULES, createVitals, resolveDamage, sweep, clock };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SinCombat = api;
})(globalThis);
