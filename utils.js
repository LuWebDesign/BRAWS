/**
 * utils.js — Helpers de color y utilidades globales.
 */

function lerp(a, b, t) { return a + (b - a) * t; }

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function lightenColor(hex, amount) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = clamp((n >> 16)        + amount, 0, 255);
  const g = clamp((n >> 8 & 0xFF)  + amount, 0, 255);
  const b = clamp((n & 0xFF)       + amount, 0, 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function darkenColor(hex, amount) {
  return lightenColor(hex, -amount);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  return { r: (n >> 16) & 0xFF, g: (n >> 8) & 0xFF, b: n & 0xFF };
}
