// Procedural Pixel-Art Telemetry Cockpit ("Bé Turbo") for Quota & Speed Meter
// Zero external images, reads CSS theme tokens dynamically, crisp nearest-neighbor rendering.

const CAT_IDLE = [
  '....KK....KK....',
  '...KOPK..KPOK...',
  '..KGGGGKKGGGGK..',
  '.KGLBGGGGGBLGKK.',
  '.KGGGGKKKKGGGGK.',
  '.BKWWKWWWWKWWKB.',
  '.BKWPWWWWWWPWKB.',
  '..KWWWWKKWWWWK..',
  '...KWWWWWWWWK...',
  '..KWWWSWWWSWWK..',
  '..KWWWWWWWWWWK.K',
  '..KWWWSWWWSWWKKO',
  '...KWWWWWWWWKKO.',
  '...KWWK..KWWK...',
  '...KKK....KKK...',
  '................',
];

const CAT_WORK = [
  '................',
  '....KK....KK....',
  '...KOPK..KPOK...',
  '..KGGGGKKGGGGK..',
  '.KGLBGGGGGBLGKK.',
  '.KGGGGKKKKGGGGK.',
  '.BKWWKWWWWKWWKB.',
  '.BKWPWWWWWWPWKB.',
  '..KWWWWKKWWWWK..',
  '...KWWWWWWWWK..K',
  '..KWWWSWWWSWWKKO',
  '.KKWWWWWWWWWWKO.',
  'KWWKWWWSWWWSWK..',
  '.KK.KWWKKWWK....',
  '....KKK..KKK....',
  '................',
];

const CAT_HAPPY = [
  '....KK....KK....',
  '...KOPK..KPOK...',
  '..KGGGGKKGGGGK..',
  '.KGLBGGGGGBLGKK.',
  '.KGGGGKKKKGGGGK.',
  '.BKWKKWWWWKKWKB.',
  '.BKWPWWWWWWPWKB.',
  '..KWWWWPKWWWWK..',
  '.K.KWWWWWWWWK.K.',
  'KWKKWWSWWWSWKKWK',
  '.KKWWWWWWWWWWKK.',
  '..KWWWSWWWSWWK.K',
  '...KWWWWWWWWKKO.',
  '..KWWK....KWWK..',
  '..KKK......KKK..',
  '................',
];

const MUG = [
  '..W..W..',
  '...W..W.',
  '.KKKKKK.',
  '.KYYYYK.',
  '.KCCCCKK',
  '.KCCCCVK',
  '.KCCCCKK',
  '..KKKK..',
];

const HEART = [
  '.KK.KK.',
  'KPPKPPK',
  'KPPPPPK',
  '.KPPPK.',
  '..KPK..',
  '...K...',
];

const ORB = [
  '.KKKK.',
  'KLYYYK',
  'KYYYYK',
  'KYYRYK',
  'KYYYYK',
  '.KKKK.',
];

const SPEECH_IDLE = [
  'Bé Turbo đang gác đồng hồ quota cho anh…',
  'Ngủ gật xíu thôi, có prompt mới là em phi ngay!',
  'Bấm vào sân khấu để thưởng xu & thả tim cho em nhé.',
];

const SPEECH_WORK = [
  'Đang gõ lách tách theo từng token trả về!',
  'Quạt turbo đã bật, đang đo tok/s theo thời gian thực…',
  'Các gói dữ liệu đang chạy mượt qua buồng lái!',
];

const SPEECH_BURST = [
  'Tốc độ cao! Nạp đầy lõi năng lượng token!',
  'Turbo boost! Tok/s đang vọt lên cực mượt!',
  'Bắt trọn từng đợt token mới về máy!',
];

const SPEECH_LOW = [
  'Cảnh báo: một nhóm model sắp chạm ngưỡng quota!',
  'Uống ngụm cà phê pixel và kiểm tra đồng hồ quota nhé anh.',
];

const SPEECH_PET = [
  'Meo meo! Cảm ơn anh đã tiếp sức cho Bé Turbo!',
  'Đã đồng bộ cảm hứng +100% tốc độ!',
];

function cssToken(styles, name, fallback = '') {
  const val = styles.getPropertyValue(name);
  return val ? val.trim() : fallback;
}

export class PixelTelemetryStage {
  constructor(canvas, speechEl, { onInteract } = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.speechEl = speechEl || null;
    this.onInteract = onInteract || null;

    this.theme = 'dark';
    this.activityState = 'idle';
    this.tokPerSec = 0;
    this.minRemainingPct = 100;
    this.happyTimer = 0;
    this.tick = 0;
    this.rafId = 0;
    this.lastFrameMs = 0;
    this.speechIndex = 0;
    this.lastSpeechCycle = 0;

    this.tokens = this._readThemeTokens();
    this.palette = this._buildPalette(this.tokens);

    this.particles = [];
    this.dataPackets = [];
    this.stars = Array.from({ length: 14 }, (_, i) => ({
      x: 10 + ((i * 23) % 66),
      y: 6 + ((i * 11) % 24),
      phase: i * 0.7,
    }));

    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._handleClick = this._handleClick.bind(this);
    this._loop = this._loop.bind(this);
    this._handleVisibility = this._handleVisibility.bind(this);

    if (this.canvas) {
      this.canvas.addEventListener('click', this._handleClick);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleVisibility);
    }
  }

  _readThemeTokens() {
    if (typeof window === 'undefined' || !document.documentElement) {
      return {};
    }
    const cs = getComputedStyle(document.documentElement);
    return {
      sky: cssToken(cs, '--px-sky'),
      wall: cssToken(cs, '--px-wall'),
      trim: cssToken(cs, '--px-trim'),
      floor: cssToken(cs, '--px-floor'),
      deskTop: cssToken(cs, '--px-desk-top'),
      deskEdge: cssToken(cs, '--px-desk-edge'),
      frame: cssToken(cs, '--px-frame'),
      screen: cssToken(cs, '--px-screen'),
      star: cssToken(cs, '--px-star'),
      starDim: cssToken(cs, '--px-star-dim'),
      sun: cssToken(cs, '--px-sun'),
      cloud: cssToken(cs, '--px-cloud'),
      fur: cssToken(cs, '--px-fur'),
      furShade: cssToken(cs, '--px-fur-shade'),
      ginger: cssToken(cs, '--px-ginger'),
      gingerShade: cssToken(cs, '--px-ginger-shade'),
      blush: cssToken(cs, '--px-blush'),
      cyan: cssToken(cs, '--accent-cyan'),
      cyanDeep: cssToken(cs, '--px-cyan-deep'),
      gold: cssToken(cs, '--px-gold'),
      emerald: cssToken(cs, '--accent-emerald'),
      mint: cssToken(cs, '--px-mint'),
      coral: cssToken(cs, '--accent-coral'),
      amber: cssToken(cs, '--accent-amber'),
      silver: cssToken(cs, '--px-silver'),
      metal: cssToken(cs, '--px-metal'),
      ink: cssToken(cs, '--pixel-ink'),
    };
  }

  _buildPalette(t) {
    return {
      '.': null,
      K: t.ink,
      W: t.fur,
      S: t.furShade,
      O: t.ginger,
      D: t.gingerShade,
      P: t.blush,
      G: t.cyan,
      B: t.cyanDeep,
      Y: t.gold,
      L: t.star,
      M: t.emerald,
      E: t.mint,
      R: t.coral,
      C: t.silver,
      V: t.metal,
    };
  }

  setTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark';
    this.tokens = this._readThemeTokens();
    this.palette = this._buildPalette(this.tokens);
    this.drawOnce();
  }

  setTelemetry({ activityState, tokPerSec, minRemainingPct } = {}) {
    const prevState = this.activityState;
    if (activityState) this.activityState = activityState;
    if (Number.isFinite(tokPerSec)) this.tokPerSec = tokPerSec;
    if (Number.isFinite(minRemainingPct)) this.minRemainingPct = minRemainingPct;

    if (prevState !== this.activityState) {
      this._updateSpeech(true);
    }
    if (this.reducedMotion) {
      this.drawOnce();
    }
  }

  start() {
    this.tokens = this._readThemeTokens();
    this.palette = this._buildPalette(this.tokens);
    this.drawOnce();
    if (this.reducedMotion || this.rafId) return;
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  destroy() {
    this.stop();
    if (this.canvas) {
      this.canvas.removeEventListener('click', this._handleClick);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibility);
    }
  }

  _handleVisibility() {
    if (document.hidden) {
      this.stop();
    } else if (!this.reducedMotion) {
      this.start();
    }
  }

  _handleClick() {
    this.happyTimer = 95;
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        kind: i % 2 === 0 ? 'heart' : 'orb',
        x: 52 + (Math.random() - 0.5) * 28,
        y: 34 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.7,
        vy: -0.6 - Math.random() * 0.6,
        life: 55 + Math.floor(Math.random() * 20),
      });
    }
    const line = SPEECH_PET[Math.floor(Math.random() * SPEECH_PET.length)];
    if (this.speechEl) this.speechEl.textContent = line;
    this.lastSpeechCycle = this.tick;
    if (typeof this.onInteract === 'function') {
      this.onInteract();
    }
    if (this.reducedMotion) {
      this.drawOnce();
    }
  }

  _updateSpeech(force = false) {
    if (!this.speechEl) return;
    if (!force && this.tick - this.lastSpeechCycle < 240) return;
    this.lastSpeechCycle = this.tick;
    this.speechIndex += 1;

    let pool = SPEECH_IDLE;
    if (this.minRemainingPct < 20) pool = SPEECH_LOW;
    else if (this.activityState === 'burst') pool = SPEECH_BURST;
    else if (this.activityState === 'working') pool = SPEECH_WORK;

    this.speechEl.textContent = pool[this.speechIndex % pool.length];
  }

  _loop(now) {
    if (now - this.lastFrameMs >= 66) {
      this.lastFrameMs = now;
      this.tick += 1;
      if (this.happyTimer > 0) this.happyTimer -= 1;
      this._stepPhysics();
      this._updateSpeech(false);
      this.drawOnce();
    }
    this.rafId = requestAnimationFrame(this._loop);
  }

  _stepPhysics() {
    const t = this.tokens;
    const spawnChance =
      this.activityState === 'burst' ? 0.55 : this.activityState === 'working' ? 0.28 : 0.04;
    if (Math.random() < spawnChance && this.dataPackets.length < 14) {
      this.dataPackets.push({
        x: 92 + Math.random() * 14,
        y: 28 + Math.floor(Math.random() * 3) * 4,
        vx: this.activityState === 'burst' ? 2.1 : 1.25,
        color: this.activityState === 'burst' ? t.gold : t.cyan,
      });
    }

    for (let i = this.dataPackets.length - 1; i >= 0; i--) {
      const p = this.dataPackets[i];
      p.x += p.vx;
      if (p.x > 168) {
        this.dataPackets.splice(i, 1);
      }
    }

    if (this.activityState === 'idle' && this.happyTimer === 0 && this.tick % 40 === 0) {
      this.particles.push({
        kind: 'zzz',
        x: 68,
        y: 20,
        vx: 0.16,
        vy: -0.25,
        life: 48,
      });
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life -= 1;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  _drawSprite(sprite, x, y, scale = 2) {
    const ctx = this.ctx;
    for (let row = 0; row < sprite.length; row++) {
      const line = sprite[row];
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        const color = this.palette[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x + col * scale), Math.round(y + row * scale), scale, scale);
      }
    }
  }

  drawOnce() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const t = this.tokens;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.imageSmoothingEnabled = false;

    const isDark = this.theme === 'dark';

    // 1. Room wall & floor
    ctx.fillStyle = t.wall;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = t.trim;
    ctx.fillRect(0, 56, w, 2);
    ctx.fillStyle = t.floor;
    ctx.fillRect(0, 58, w, h - 58);

    // 2. Porthole / Retro window (left)
    ctx.fillStyle = t.trim;
    ctx.fillRect(10, 6, 56, 36);
    ctx.fillStyle = t.sky;
    ctx.fillRect(12, 8, 52, 32);

    if (isDark) {
      for (const s of this.stars) {
        const bright = Math.sin(this.tick * 0.12 + s.phase) > 0;
        ctx.fillStyle = bright ? t.star : t.starDim;
        ctx.fillRect(s.x, s.y, 2, 2);
      }
      ctx.fillStyle = t.sun;
      ctx.fillRect(50, 12, 6, 6);
      ctx.fillStyle = t.sky;
      ctx.fillRect(52, 12, 4, 4);
    } else {
      ctx.fillStyle = t.gold;
      ctx.fillRect(50, 12, 6, 6);
      ctx.fillStyle = t.cloud;
      ctx.fillRect(18, 16, 14, 4);
      ctx.fillRect(20, 14, 10, 2);
    }
    ctx.fillStyle = t.trim;
    ctx.fillRect(37, 8, 2, 32);
    ctx.fillRect(12, 23, 52, 2);

    // 3. Telemetry Battery Core (right side)
    const coreX = 166;
    const coreY = 12;
    ctx.fillStyle = t.frame;
    ctx.fillRect(coreX, coreY, 24, 34);
    ctx.fillStyle = t.screen;
    ctx.fillRect(coreX + 2, coreY + 2, 20, 30);

    const fillColor =
      this.minRemainingPct < 20
        ? t.coral
        : this.minRemainingPct < 50
          ? t.amber
          : t.emerald;
    const barBlocks = Math.max(1, Math.round((this.minRemainingPct / 100) * 6));
    for (let b = 0; b < barBlocks; b++) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(coreX + 4, coreY + 26 - b * 4, 16, 3);
    }
    const ledOn =
      this.activityState === 'burst'
        ? this.tick % 4 < 2
        : this.activityState === 'working'
          ? this.tick % 8 < 4
          : this.tick % 20 < 10;
    ctx.fillStyle = ledOn ? t.cyan : t.frame;
    ctx.fillRect(coreX + 10, coreY - 4, 4, 4);

    // 4. Spinning Turbo Fan on console (middle-right)
    const fanX = 142;
    const fanY = 30;
    ctx.fillStyle = t.frame;
    ctx.fillRect(fanX, fanY, 16, 16);
    ctx.fillStyle = t.screen;
    ctx.fillRect(fanX + 2, fanY + 2, 12, 12);

    const fanSpeed =
      this.activityState === 'burst' ? 1 : this.activityState === 'working' ? 2 : 6;
    const fanPhase = Math.floor(this.tick / fanSpeed) % 2;
    ctx.fillStyle = this.activityState === 'burst' ? t.gold : t.cyan;
    if (fanPhase === 0) {
      ctx.fillRect(fanX + 7, fanY + 3, 2, 10);
      ctx.fillRect(fanX + 3, fanY + 7, 10, 2);
    } else {
      ctx.fillRect(fanX + 4, fanY + 4, 2, 2);
      ctx.fillRect(fanX + 10, fanY + 4, 2, 2);
      ctx.fillRect(fanX + 4, fanY + 10, 2, 2);
      ctx.fillRect(fanX + 10, fanY + 10, 2, 2);
      ctx.fillStyle = t.silver;
      ctx.fillRect(fanX + 7, fanY + 7, 2, 2);
    }

    // 5. Twin Telemetry Monitor (center)
    const monX = 82;
    const monY = 18;
    ctx.fillStyle = t.frame;
    ctx.fillRect(monX, monY, 52, 28);
    ctx.fillStyle = t.screen;
    ctx.fillRect(monX + 2, monY + 2, 48, 22);
    ctx.fillStyle = t.metal;
    ctx.fillRect(monX + 22, monY + 46, 8, 4);

    for (let i = 0; i < 9; i++) {
      const baseH =
        this.activityState === 'burst'
          ? 12
          : this.activityState === 'working'
            ? 8
            : 3;
      const wave = Math.round(
        (Math.sin(this.tick * 0.45 + i * 0.9) * 0.5 + 0.5) * baseH + 2
      );
      const barH = Math.min(18, wave);
      ctx.fillStyle =
        barH > 12 ? t.gold : barH > 7 ? t.cyan : t.emerald;
      ctx.fillRect(monX + 5 + i * 5, monY + 21 - barH, 3, barH);
    }

    // 6. Data packets flying from monitor to battery core
    for (const pkt of this.dataPackets) {
      ctx.fillStyle = pkt.color || t.cyan;
      ctx.fillRect(Math.round(pkt.x), Math.round(pkt.y), 3, 2);
    }

    // 7. Desk surface
    ctx.fillStyle = t.deskTop;
    ctx.fillRect(24, 48, 174, 6);
    ctx.fillStyle = t.deskEdge;
    ctx.fillRect(24, 54, 174, 4);

    // 8. Bé Turbo (Pixel Cat Engineer) sitting by desk
    let catSprite = CAT_IDLE;
    let catYOffset = 0;
    if (this.happyTimer > 0) {
      catSprite = CAT_HAPPY;
      catYOffset = this.happyTimer % 8 < 4 ? -2 : 0;
    } else if (this.activityState === 'burst' || this.activityState === 'working') {
      catSprite = this.tick % 6 < 3 ? CAT_WORK : CAT_IDLE;
      catYOffset = this.activityState === 'burst' && this.tick % 4 < 2 ? -1 : 0;
    } else {
      catYOffset = Math.floor(this.tick / 14) % 2;
    }
    this._drawSprite(catSprite, 40, 22 + catYOffset, 2);

    // 9. Low-quota coffee mug beside cat
    if (this.minRemainingPct < 20) {
      this._drawSprite(MUG, 14, 38, 1.5);
    }

    // 10. Floating hearts / orbs / zZz
    for (const pt of this.particles) {
      if (pt.kind === 'heart') {
        this._drawSprite(HEART, pt.x, pt.y, 1.5);
      } else if (pt.kind === 'orb') {
        this._drawSprite(ORB, pt.x, pt.y, 1.5);
      } else if (pt.kind === 'zzz') {
        ctx.fillStyle = t.starDim;
        ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 4, 1);
        ctx.fillRect(Math.round(pt.x + 2), Math.round(pt.y + 1), 2, 1);
        ctx.fillRect(Math.round(pt.x), Math.round(pt.y + 2), 4, 1);
      }
    }
  }
}
