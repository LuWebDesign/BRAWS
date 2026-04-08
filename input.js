/**
 * input.js — Captura de teclado WASD/flechas + joystick mobile.
 */

class InputHandler {
  constructor() {
    this.keys        = {};
    this.lastInput   = { dx: 0, dy: 0, action: false };
    this._joystick   = { dx: 0, dy: 0 };
    this._specialBtn = false;
    this._bindEvents();
  }

  _bindEvents() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });

    // Botón especial mobile
    const btnSpecial = document.getElementById('btn-special');
    if (btnSpecial) {
      btnSpecial.addEventListener('touchstart', e => { e.preventDefault(); this._specialBtn = true;  }, { passive: false });
      btnSpecial.addEventListener('touchend',   e => { e.preventDefault(); this._specialBtn = false; }, { passive: false });
    }

    this._bindJoystick();
  }

  _bindJoystick() {
    const area  = document.getElementById('joystick-area');
    const thumb = document.getElementById('joystick-thumb');
    if (!area) return;

    const DEADZONE = 10;
    const MAX_DIST = 50;
    let active = false;
    let startX = 0, startY = 0;

    const update = (clientX, clientY) => {
      const dx   = clientX - startX;
      const dy   = clientY - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > DEADZONE) {
        const angle = Math.atan2(dy, dx);
        const norm  = Math.min(dist, MAX_DIST) / MAX_DIST;
        this._joystick.dx = Math.cos(angle) * norm;
        this._joystick.dy = Math.sin(angle) * norm;
        if (thumb) {
          const cx = Math.cos(angle) * Math.min(dist, MAX_DIST);
          const cy = Math.sin(angle) * Math.min(dist, MAX_DIST);
          thumb.style.transform = `translate(${cx}px, ${cy}px)`;
        }
      } else {
        this._joystick.dx = 0;
        this._joystick.dy = 0;
        if (thumb) thumb.style.transform = '';
      }
    };

    const reset = () => {
      active = false;
      this._joystick.dx = 0;
      this._joystick.dy = 0;
      if (thumb) thumb.style.transform = '';
    };

    area.addEventListener('touchstart', e => {
      e.preventDefault();
      active = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      update(startX, startY);
    }, { passive: false });

    area.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!active) return;
      update(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    area.addEventListener('touchend',   reset);
    area.addEventListener('touchcancel', reset);
  }

  getInput() {
    const k = this.keys;
    let dx = 0, dy = 0;

    if (k['KeyW'] || k['ArrowUp'])    dy -= 1;
    if (k['KeyS'] || k['ArrowDown'])  dy += 1;
    if (k['KeyA'] || k['ArrowLeft'])  dx -= 1;
    if (k['KeyD'] || k['ArrowRight']) dx += 1;

    // Normalizar diagonal
    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    // Joystick mobile tiene prioridad si está siendo usado
    if (Math.abs(this._joystick.dx) > 0.01 || Math.abs(this._joystick.dy) > 0.01) {
      dx = this._joystick.dx;
      dy = this._joystick.dy;
    }

    const action = !!(k['Space'] || this._specialBtn);
    return { dx, dy, action, timestamp: Date.now() };
  }
}
