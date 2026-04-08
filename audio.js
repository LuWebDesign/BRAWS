/**
 * audio.js — Motor de audio procedural via Web Audio API.
 * No requiere archivos externos. Se inicializa con la primera interacción del usuario.
 */

const audio = (() => {
  let ctx = null;
  let sfxEnabled   = true;
  let musicEnabled = true;
  let sfxVol       = 0.7;
  let musicVol     = 0.4;
  let musicOscs    = [];
  let musicGainNode = null;

  function _getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function _tone({ freq = 440, type = 'sine', gain = 0.3, duration = 0.2,
                   attack = 0.01, start = 0, detune = 0 } = {}) {
    if (!sfxEnabled) return;
    const c = _getCtx();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.connect(g);
    g.connect(c.destination);
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * sfxVol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  function _noise(duration = 0.15, gainVal = 0.3, decayFactor = 0.3) {
    if (!sfxEnabled) return;
    const c = _getCtx();
    const samples = Math.floor(c.sampleRate * duration);
    const buf  = c.createBuffer(1, samples, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (samples * decayFactor));
    }
    const src = c.createBufferSource();
    const g   = c.createGain();
    src.buffer = buf;
    src.connect(g);
    g.connect(c.destination);
    g.gain.value = gainVal * sfxVol;
    src.start();
  }

  return {
    _tone,

    playCountdown(count) {
      if (count === 1) {
        _tone({ freq: 880, type: 'square', gain: 0.3, duration: 0.5, attack: 0.01 });
        _tone({ freq: 1100, type: 'sine',  gain: 0.2, duration: 0.3, attack: 0.005, start: 0.15 });
      } else {
        _tone({ freq: 440, type: 'square', gain: 0.2, duration: 0.2, attack: 0.01 });
      }
    },

    playCollision(intensity = 0.5) {
      _noise(0.12, Math.min(0.4, intensity * 0.55), 0.25);
    },

    playDash() {
      _tone({ freq: 300, type: 'sawtooth', gain: 0.15, duration: 0.08, attack: 0.005 });
      _tone({ freq: 620, type: 'sine',     gain: 0.20, duration: 0.15, attack: 0.005, start: 0.05 });
    },

    playLocalDeath() {
      _tone({ freq: 220, type: 'sawtooth', gain: 0.4, duration: 0.6, attack: 0.01 });
      _tone({ freq: 110, type: 'sine',     gain: 0.3, duration: 0.8, attack: 0.05, start: 0.2 });
      _noise(0.3, 0.2, 0.5);
    },

    playElimination() {
      _tone({ freq: 440, type: 'square', gain: 0.2, duration: 0.10, attack: 0.005 });
      _tone({ freq: 330, type: 'square', gain: 0.15, duration: 0.15, attack: 0.005, start: 0.08 });
    },

    playPowerUpSpawn() {
      _tone({ freq: 523, type: 'sine', gain: 0.12, duration: 0.15, attack: 0.01 });
      _tone({ freq: 659, type: 'sine', gain: 0.10, duration: 0.15, attack: 0.01, start: 0.10 });
    },

    playPowerUp(type) {
      const seqs = {
        speed:  [660, 880, 1100],
        shield: [330, 440, 550],
        big:    [220, 330, 440],
      };
      const seq = seqs[type] || seqs.speed;
      seq.forEach((f, i) =>
        _tone({ freq: f, type: 'sine', gain: 0.18, duration: 0.12, attack: 0.005, start: i * 0.08 })
      );
    },

    playVictory() {
      [523, 659, 784, 1047].forEach((f, i) =>
        _tone({ freq: f, type: 'sine', gain: 0.25, duration: 0.25, attack: 0.01, start: i * 0.15 })
      );
    },

    playDefeat() {
      [330, 262, 196].forEach((f, i) =>
        _tone({ freq: f, type: 'sawtooth', gain: 0.2, duration: 0.3, attack: 0.02, start: i * 0.2 })
      );
    },

    playWallHit() {
      _tone({ freq: 180, type: 'square', gain: 0.15, duration: 0.06, attack: 0.002 });
    },

    startGameMusic() {
      if (!musicEnabled) return;
      this._startAmbient();
    },

    stopMusic() {
      musicOscs.forEach(o => { try { o.stop(); } catch (_) {} });
      musicOscs = [];
      if (musicGainNode) { try { musicGainNode.disconnect(); } catch (_) {} musicGainNode = null; }
    },

    _startAmbient() {
      this.stopMusic();
      if (!musicEnabled) return;
      const c = _getCtx();
      musicGainNode = c.createGain();
      musicGainNode.gain.value = musicVol * 0.12;
      musicGainNode.connect(c.destination);

      // Drone base
      [55, 110, 165.5].forEach(freq => {
        const osc    = c.createOscillator();
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 14;
        osc.connect(filter);
        filter.connect(musicGainNode);
        osc.start();
        musicOscs.push(osc);
      });
    },

    toggleSFX() {
      sfxEnabled = !sfxEnabled;
      return sfxEnabled;
    },

    toggleMusic() {
      musicEnabled = !musicEnabled;
      if (musicEnabled) this._startAmbient();
      else this.stopMusic();
      return musicEnabled;
    },

    setSFXVolume(v) {
      sfxVol = Math.max(0, Math.min(1, v));
    },

    setMusicVolume(v) {
      musicVol = Math.max(0, Math.min(1, v));
      if (musicGainNode) musicGainNode.gain.value = musicVol * 0.12;
    },
  };
})();
