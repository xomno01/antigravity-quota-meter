import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import { PixelTelemetryStage } from './pixel-stage.js';

const POLL_INTERVAL_MS = 1500;
const CONNECT_TIMEOUT_MS = 700;
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * 22; // r = 22 -> ~138.23

const state = {
  liveEnabled: true,
  isPolling: false,
  snapshot: null,
  hostConnected: false,
  countdownOffsetSec: 0,
  editingBucketId: '',
};

const els = {
  subtitle: document.getElementById('status-subtitle'),
  liveToggleBtn: document.getElementById('live-toggle-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  retryBtn: document.getElementById('retry-btn'),
  speedArc: document.getElementById('speed-arc'),
  speedNeedle: document.getElementById('speed-needle'),
  speedCurrent: document.getElementById('speed-current'),
  activityChip: document.getElementById('activity-chip'),
  activeModelName: document.getElementById('active-model-name'),
  speedAvg: document.getElementById('speed-avg'),
  speedPeak: document.getElementById('speed-peak'),
  speed5m: document.getElementById('speed-5m'),
  speedSampleNote: document.getElementById('speed-sample-note'),
  speedSparkline: document.getElementById('speed-sparkline'),
  pixelCanvas: document.getElementById('pixel-stage'),
  pixelSpeech: document.getElementById('pixel-speech-text'),
  quotaGrid: document.getElementById('quota-grid'),
  calibPanel: document.getElementById('calib-panel'),
  calibTitle: document.getElementById('calib-title'),
  calibCloseBtn: document.getElementById('calib-close-btn'),
  calibForm: document.getElementById('calib-form'),
  calibBucketId: document.getElementById('calib-bucket-id'),
  calibWindow: document.getElementById('calib-window'),
  calibPct: document.getElementById('calib-pct'),
  calibReset: document.getElementById('calib-reset'),
  calibLimit5h: document.getElementById('calib-limit-5h'),
  calibLimit7d: document.getElementById('calib-limit-7d'),
  calibResetBtn: document.getElementById('calib-reset-btn'),
  turnsMeta: document.getElementById('turns-scan-meta'),
  turnsTbody: document.getElementById('turns-tbody'),
};

function fmtCompact(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtCountdown(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s <= 0) return 'Sẵn sàng';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (d > 0) {
    return `${d}d ${String(h).padStart(2, '0')}h`;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function parseDurationInput(raw) {
  const str = String(raw || '').trim().toLowerCase();
  if (!str) return null;
  if (/^\d+$/.test(str)) return Number(str);

  let totalSec = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)\s*(d|ngày|h|giờ|m|phút|s|giây)/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    matched = true;
    const val = Number(m[1]);
    const unit = m[2];
    if (unit === 'd' || unit === 'ngày') totalSec += val * 86400;
    else if (unit === 'h' || unit === 'giờ') totalSec += val * 3600;
    else if (unit === 'm' || unit === 'phút') totalSec += val * 60;
    else if (unit === 's' || unit === 'giây') totalSec += val;
  }
  if (matched) return Math.round(totalSec);

  const hhmm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
  if (hhmm) {
    return Number(hhmm[1]) * 3600 + Number(hhmm[2]) * 60 + Number(hhmm[3] || 0);
  }
  return null;
}

function fmtLocalTime(isoStr) {
  if (!isoStr) return '--:--:--';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function showError(msg) {
  if (!msg) {
    els.errorBanner.hidden = true;
    return;
  }
  els.errorText.textContent = msg;
  els.errorBanner.hidden = false;
}

function bucketEmblemSvg(iconType) {
  const rects = {
    gemini: [
      ['px-cyan', 3, 0, 2, 2],
      ['px-emerald', 2, 2, 4, 1],
      ['px-cyan', 0, 3, 8, 2],
      ['px-emerald', 2, 5, 4, 1],
      ['px-amber', 3, 6, 2, 2],
    ],
    claude: [
      ['px-coral', 2, 1, 4, 1],
      ['px-coral', 1, 2, 6, 4],
      ['px-ink', 2, 3, 1, 1],
      ['px-ink', 5, 3, 1, 1],
      ['px-amber', 3, 5, 2, 1],
    ],
    other: [
      ['px-slate', 2, 1, 4, 5],
      ['px-ink', 3, 2, 2, 3],
      ['px-slate', 1, 3, 1, 2],
      ['px-slate', 6, 3, 1, 2],
    ],
  };

  const parts = rects[iconType] || rects.other;
  const svgRects = parts
    .map(([cls, x, y, w, h]) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join('');
  return `<svg class="pixel-emblem" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${svgRects}</svg>`;
}

function severityClass(remainingPct) {
  if (remainingPct < 20) return 'is-low';
  if (remainingPct < 50) return 'is-warn';
  return '';
}

function renderSpeedometer(snapshot) {
  const sp = snapshot.speed;
  const displayTokSec =
    sp.currentTokPerSec > 0 ? sp.currentTokPerSec : sp.lastKnownTokPerSec;

  els.speedCurrent.textContent = displayTokSec > 0 ? displayTokSec.toFixed(1) : '0.0';

  const maxDial = Math.max(
    160,
    Math.ceil(Math.max(displayTokSec, Number(sp.peakTokPerSec) || 0) / 40) * 40
  );
  const ratio = Math.min(1, Math.max(0, displayTokSec / maxDial));
  const deg = -110 + ratio * 220;
  els.speedNeedle.style.transform = `rotate(${deg.toFixed(1)}deg)`;

  const arcTotal = 295;
  const offset = arcTotal * (1 - ratio);
  els.speedArc.style.strokeDashoffset = String(offset.toFixed(1));
  els.speedArc.classList.toggle('is-burst', snapshot.activityState === 'burst');

  const chipMap = {
    burst: 'Đang tăng tốc',
    working: 'Đang xử lý',
    idle: sp.currentTokPerSec > 0 ? 'Vừa xong' : 'Đang chờ',
  };
  els.activityChip.textContent = chipMap[snapshot.activityState] || 'Đang chờ';
  els.activityChip.className = `state-chip${
    snapshot.activityState === 'burst'
      ? ' is-burst'
      : snapshot.activityState === 'working'
        ? ' is-working'
        : ''
  }`;

  els.activeModelName.textContent = snapshot.activeModel || 'Chưa xác định';
  els.speedAvg.textContent = `${Number(sp.avgTokPerSec || 0).toFixed(1)} tok/s`;
  els.speedPeak.textContent = `${Number(sp.peakTokPerSec || 0).toFixed(1)} tok/s`;
  els.speed5m.textContent = `${fmtCompact(sp.tokensPerMin5m || 0)}/phút`;
  els.speedSampleNote.textContent = `${sp.sampleCount24h || 0} mẫu trong 24h`;

  renderSparkline(sp.history || []);
}

function renderSparkline(history) {
  const svg = els.speedSparkline;
  if (!history || history.length === 0) {
    svg.innerHTML =
      '<text x="140" y="24" text-anchor="middle" fill="currentColor" opacity="0.45" font-size="11">Chưa có mẫu tốc độ gần đây</text>';
    return;
  }

  const w = 280;
  const h = 42;
  const padX = 4;
  const padY = 5;
  const maxVal = Math.max(40, ...history.map((p) => Number(p.tokPerSec) || 0));

  const coords = history.map((p, idx) => {
    const x =
      history.length === 1
        ? w / 2
        : padX + (idx / (history.length - 1)) * (w - padX * 2);
    const ratio = Math.min(1, Math.max(0, (Number(p.tokPerSec) || 0) / maxVal));
    const y = h - padY - ratio * (h - padY * 2);
    return [x, y];
  });

  const linePoints = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const firstX = coords[0][0].toFixed(1);
  const lastX = coords[coords.length - 1][0].toFixed(1);
  const areaPoints = `${firstX},${h - 2} ${linePoints} ${lastX},${h - 2}`;
  const [tipX, tipY] = coords[coords.length - 1];

  svg.innerHTML = `
    <polygon class="sparkline-area" points="${areaPoints}" />
    <polyline class="sparkline-line" points="${linePoints}" />
    <circle class="sparkline-dot" cx="${tipX.toFixed(1)}" cy="${tipY.toFixed(1)}" r="3" />
  `;
}

function renderClockSlot(title, w) {
  const pct = Number(w.remainingPct || 0);
  const sev = severityClass(pct);
  const offset = CLOCK_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const resetSec = Math.max(0, (w.nextResetInSec || 0) - state.countdownOffsetSec);
  const modeLabel = w.sourceMode === 'synced' ? 'Đã đồng bộ' : 'Mốc mặc định';

  return `
    <div class="dual-clock-slot">
      <svg class="clock-svg" viewBox="0 0 56 56" aria-label="${title} còn lại ${pct}%">
        <circle class="clock-ring-track" cx="28" cy="28" r="22" />
        <circle
          class="clock-ring-val ${sev}"
          cx="28"
          cy="28"
          r="22"
          stroke-dasharray="${CLOCK_CIRCUMFERENCE.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"
        />
      </svg>
      <div class="clock-figures">
        <div class="clock-pct-row">
          <span class="clock-win-label">${title}</span>
          <span class="clock-mode">${modeLabel}</span>
        </div>
        <div class="clock-pct-row">
          <span class="clock-pct">${pct.toFixed(1)}%</span>
          <span class="clock-usage-line">${fmtCompact(w.total)} / ${fmtCompact(w.limit)}</span>
        </div>
        <span class="clock-reset-line" data-reset-base="${w.nextResetInSec}">Reset: ${fmtCountdown(resetSec)}</span>
      </div>
    </div>
  `;
}

function renderQuotaGrid(snapshot) {
  const buckets = snapshot.buckets || [];
  if (buckets.length === 0) {
    els.quotaGrid.innerHTML =
      '<div class="quota-tile"><span class="section-hint">Chưa phát hiện dữ liệu sử dụng model nào.</span></div>';
    return;
  }

  const activeBucket = snapshot.activeBucketId || '';

  els.quotaGrid.innerHTML = buckets
    .map((b) => {
      const activeCls = b.id === activeBucket ? ' is-active-bucket' : '';
      const subModels = (b.w5h?.subModels?.length ? b.w5h.subModels : b.w7d?.subModels) || [];
      const subText =
        subModels.length > 0
          ? subModels.map((m) => `${m.model} (${fmtCompact(m.total)})`).join(', ')
          : 'Chưa phát sinh lượt trong chu kỳ hiện tại';

      return `
        <article class="quota-tile${activeCls}" data-bucket-id="${b.id}">
          <div class="quota-tile-head">
            <div class="quota-bucket-id">
              ${bucketEmblemSvg(b.iconType)}
              <span class="quota-bucket-name" title="${b.label}">${b.label}</span>
            </div>
            <button class="calib-trigger" type="button" data-calib-bucket="${b.id}">Đồng bộ</button>
          </div>
          <div class="dual-clocks-row">
            ${renderClockSlot('5h limit', b.w5h)}
            ${renderClockSlot('Weekly limit', b.w7d)}
          </div>
          <div class="quota-tile-foot">
            <span class="submodel-line" title="${subText}">${subText}</span>
            <span class="cache-line">Cache ${b.w5h.cacheHitRate}%</span>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderTurnsTable(snapshot) {
  const turns = snapshot.speed?.recentTurns || [];
  els.turnsMeta.textContent = `Cập nhật ${fmtLocalTime(snapshot.generatedAt)} (${snapshot.scanDurationMs}ms)`;

  if (turns.length === 0) {
    els.turnsTbody.innerHTML =
      '<tr><td colspan="5" class="empty-cell">Chưa có lượt phản hồi nào trong 7 ngày qua.</td></tr>';
    return;
  }

  const maxSpeed = Math.max(40, ...turns.map((t) => Number(t.tokPerSec) || 0));
  els.turnsTbody.innerHTML = turns
    .slice(0, 8)
    .map((t) => {
      const speedText = t.tokPerSec !== null ? `${t.tokPerSec.toFixed(1)}` : '—';
      const durText = t.durationSec !== null ? `${t.durationSec.toFixed(1)}s` : '—';
      const ratio =
        t.tokPerSec !== null ? Math.min(1, Math.max(0.05, t.tokPerSec / maxSpeed)) : 0;

      return `
        <tr>
          <td class="num">${fmtLocalTime(t.createdAt)}</td>
          <td>${t.model}</td>
          <td class="num">${fmtCompact(t.output)}</td>
          <td class="num">${durText}</td>
          <td class="num">
            <div class="speed-cell-wrap">
              <span>${speedText}</span>
              <span class="mini-bar-track" aria-hidden="true">
                <span class="mini-bar-fill" style="display:block;transform:scaleX(${ratio.toFixed(3)})"></span>
              </span>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;
  state.countdownOffsetSec = 0;

  const minPct = Math.min(
    100,
    ...(snapshot.buckets || []).flatMap((b) => [
      Number(b.w5h?.remainingPct ?? 100),
      Number(b.w7d?.remainingPct ?? 100),
    ])
  );

  els.subtitle.textContent = `${
    state.liveEnabled ? 'Live 1.5s' : 'Đang tạm dừng'
  }, ${snapshot.buckets.length} nhóm quota dùng chung`;

  renderSpeedometer(snapshot);
  renderQuotaGrid(snapshot);
  renderTurnsTable(snapshot);

  stage.setTelemetry({
    activityState: snapshot.activityState,
    tokPerSec: snapshot.speed?.currentTokPerSec || snapshot.speed?.lastKnownTokPerSec || 0,
    minRemainingPct: minPct,
  });
}

function populateCalibrationFields(bucketId, winKey) {
  if (!state.snapshot) return;
  const bucket = state.snapshot.buckets.find((b) => b.id === bucketId);
  if (!bucket) return;
  const w = winKey === '7d' ? bucket.w7d : bucket.w5h;
  els.calibPct.value = String(w.remainingPct);
  els.calibReset.value = w.nextResetInSec > 0 ? fmtCountdown(w.nextResetInSec) : '';
  els.calibLimit5h.value = String(bucket.w5h.limit);
  els.calibLimit7d.value = String(bucket.w7d.limit);
}

function openCalibration(bucketId) {
  if (!state.snapshot) return;
  const bucket = state.snapshot.buckets.find((b) => b.id === bucketId);
  if (!bucket) return;

  state.editingBucketId = bucketId;
  els.calibTitle.textContent = `Đồng bộ ${bucket.label}`;
  els.calibBucketId.value = bucket.id;
  els.calibWindow.value = '5h';
  populateCalibrationFields(bucketId, '5h');
  els.calibPanel.hidden = false;
  els.calibPct.focus();
}

function closeCalibration() {
  state.editingBucketId = '';
  els.calibPanel.hidden = true;
}

const stage = new PixelTelemetryStage(els.pixelCanvas, els.pixelSpeech, {
  onInteract: () => {
    void pollNow();
  },
});

const app = new App({ name: 'Quota & Speed Meter', version: '1.1.0' }, {});

function applyThemeFromContext(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.setAttribute('data-theme', ctx.theme);
    stage.setTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
}

app.ontoolresult = (result) => {
  const sc = result?.structuredContent;
  if (!sc) return;
  if (sc.snapshot) {
    showError('');
    renderSnapshot(sc.snapshot);
    if (sc.initialParams?.bucket) {
      openCalibration(sc.initialParams.bucket);
    }
  } else if (sc.buckets && sc.speed) {
    showError('');
    renderSnapshot(sc);
  }
};

app.onhostcontextchanged = (ctx) => {
  applyThemeFromContext(ctx);
};

async function pollNow() {
  if (!state.hostConnected || state.isPolling) return;
  state.isPolling = true;
  try {
    const res = await app.callServerTool({
      name: 'app_poll_telemetry',
      arguments: {},
    });
    if (res?.structuredContent) {
      showError('');
      renderSnapshot(res.structuredContent);
    }
  } catch (err) {
    showError(`Tạm gián đoạn kết nối cảm biến: ${err?.message || 'Lỗi MCP'}`);
  } finally {
    state.isPolling = false;
  }
}

els.liveToggleBtn.addEventListener('click', () => {
  state.liveEnabled = !state.liveEnabled;
  els.liveToggleBtn.setAttribute('aria-pressed', String(state.liveEnabled));
  els.liveToggleBtn.classList.toggle('is-live', state.liveEnabled);
  els.liveToggleBtn.textContent = state.liveEnabled ? 'Live 1.5s' : 'Tạm dừng';
  if (state.snapshot) {
    els.subtitle.textContent = `${
      state.liveEnabled ? 'Live 1.5s' : 'Đang tạm dừng'
    }, ${state.snapshot.buckets.length} nhóm quota dùng chung`;
  }
});

els.refreshBtn.addEventListener('click', () => {
  void pollNow();
});

els.retryBtn.addEventListener('click', () => {
  void pollNow();
});

els.quotaGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-calib-bucket]');
  if (!btn) return;
  openCalibration(btn.getAttribute('data-calib-bucket'));
});

els.calibWindow.addEventListener('change', () => {
  if (state.editingBucketId) {
    populateCalibrationFields(state.editingBucketId, els.calibWindow.value);
  }
});

els.calibCloseBtn.addEventListener('click', () => {
  closeCalibration();
});

els.calibForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.hostConnected) return;
  const bucketId = els.calibBucketId.value;
  if (!bucketId) return;

  const payload = { bucketId };
  const pctVal = Number(els.calibPct.value);
  const resetSec = parseDurationInput(els.calibReset.value);
  const lim5 = Number(els.calibLimit5h.value);
  const lim7 = Number(els.calibLimit7d.value);

  if (Number.isFinite(pctVal) && pctVal >= 0 && pctVal <= 100) {
    payload.syncWindow = els.calibWindow.value === '7d' ? '7d' : '5h';
    payload.syncRemainingPct = pctVal;
    if (resetSec !== null && resetSec >= 0) {
      payload.syncResetInSec = resetSec;
    }
  }
  if (Number.isFinite(lim5) && lim5 > 0) payload.limit5h = lim5;
  if (Number.isFinite(lim7) && lim7 > 0) payload.limit7d = lim7;

  try {
    const res = await app.callServerTool({
      name: 'app_save_quota_config',
      arguments: payload,
    });
    if (res?.structuredContent) {
      showError('');
      renderSnapshot(res.structuredContent);
      closeCalibration();
    }
  } catch (err) {
    showError(`Không lưu được cấu hình: ${err?.message || 'Lỗi MCP'}`);
  }
});

els.calibResetBtn.addEventListener('click', async () => {
  if (!state.hostConnected) return;
  const bucketId = els.calibBucketId.value;
  if (!bucketId) return;
  try {
    const res = await app.callServerTool({
      name: 'app_reset_quota_config',
      arguments: { bucketId },
    });
    if (res?.structuredContent) {
      showError('');
      renderSnapshot(res.structuredContent);
      closeCalibration();
    }
  } catch (err) {
    showError(`Không đặt lại được cấu hình: ${err?.message || 'Lỗi MCP'}`);
  }
});

setInterval(() => {
  if (!state.snapshot) return;
  state.countdownOffsetSec += 1;
  const nodes = els.quotaGrid.querySelectorAll('[data-reset-base]');
  for (const el of nodes) {
    const base = Number(el.getAttribute('data-reset-base')) || 0;
    const rem = Math.max(0, base - state.countdownOffsetSec);
    el.textContent = `Reset: ${fmtCountdown(rem)}`;
  }
}, 1000);

setInterval(() => {
  if (!state.liveEnabled || !state.hostConnected || document.hidden) return;
  void pollNow();
}, POLL_INTERVAL_MS);

async function init() {
  stage.start();

  try {
    await Promise.race([
      app.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('host-timeout')), CONNECT_TIMEOUT_MS)
      ),
    ]);
    state.hostConnected = true;
    applyThemeFromContext(app.getHostContext());
    if (!state.snapshot) {
      await pollNow();
    }
  } catch {
    state.hostConnected = false;
    els.subtitle.textContent = 'Chế độ xem độc lập, mở trong Antigravity Side Pane để đo live';
    els.quotaGrid.innerHTML =
      '<div class="quota-tile"><span class="section-hint">Đang chờ kết nối máy chủ MCP Quota Meter từ Antigravity.</span></div>';
    els.turnsTbody.innerHTML =
      '<tr><td colspan="5" class="empty-cell">Chưa có dữ liệu khi chạy ngoài Antigravity.</td></tr>';
  }
}

void init();
