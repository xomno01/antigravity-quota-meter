import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function build() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    write: false,
  });

  const bundledJs = result.outputFiles[0].text;
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Đồng hồ đo quota từng nhóm model theo thời gian thực (5 giờ & 7 ngày) và tốc độ token/s của Antigravity kèm animation pixel Bé Turbo." />
  <title>Quota & Speed Meter</title>
  <style>${css.trim()}</style>
</head>
<body>
  <main class="hud-shell" id="app-root">
    <header class="hud-header">
      <div class="header-title-wrap">
        <h1 class="header-title">
          <svg class="pixel-emblem" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">
            <rect class="px-emerald" x="2" y="0" width="4" height="1"/>
            <rect class="px-cyan" x="1" y="1" width="6" height="5"/>
            <rect class="px-ink" x="2" y="2" width="4" height="3"/>
            <rect class="px-amber" x="4" y="2" width="2" height="2"/>
            <rect class="px-emerald" x="1" y="6" width="6" height="1"/>
          </svg>
          <span>Quota &amp; Speed Meter</span>
        </h1>
        <p class="header-subtitle" id="status-subtitle">Đang đồng bộ cảm biến token theo thời gian thực…</p>
      </div>
      <div class="header-controls">
        <div class="window-switch" role="tablist" aria-label="Khung cửa sổ quota">
          <button class="switch-btn" role="tab" type="button" data-window="5h" aria-selected="true">5 giờ</button>
          <button class="switch-btn" role="tab" type="button" data-window="7d" aria-selected="false">7 ngày</button>
        </div>
        <button class="ctrl-btn is-live" id="live-toggle-btn" type="button" aria-pressed="true">Live 1.5s</button>
        <button class="ctrl-btn" id="refresh-btn" type="button" aria-label="Làm mới dữ liệu">Làm mới</button>
      </div>
    </header>

    <section class="error-banner" id="error-banner" hidden role="alert">
      <span id="error-text">Không đọc được dữ liệu từ máy chủ MCP.</span>
      <button class="ctrl-btn" id="retry-btn" type="button">Thử lại</button>
    </section>

    <section class="cockpit-grid" aria-label="Buồng lái tốc độ và nhân vật pixel">
      <div class="speed-panel">
        <div class="speed-dial-wrap">
          <svg class="speed-gauge-svg" viewBox="0 0 180 118" aria-label="Đồng hồ tốc độ token mỗi giây">
            <path class="gauge-arc-track" d="M 24 96 A 70 70 0 1 1 156 96" />
            <path class="gauge-arc-active" id="speed-arc" d="M 24 96 A 70 70 0 1 1 156 96" />
            <g class="gauge-needle" id="speed-needle">
              <line x1="90" y1="86" x2="90" y2="28" />
              <circle cx="90" cy="86" r="5" />
            </g>
            <text class="gauge-readout-val" x="90" y="72" text-anchor="middle" id="speed-current">0.0</text>
            <text class="gauge-readout-unit" x="90" y="108" text-anchor="middle">tok/s</text>
          </svg>
          <div class="speed-meta-col">
            <div class="speed-state-row">
              <span class="state-chip" id="activity-chip">Đang chờ</span>
              <span class="model-tag" id="active-model-name">Chưa xác định</span>
            </div>
            <dl class="speed-stats-list">
              <div class="speed-stat-item">
                <dt>Trung bình</dt>
                <dd id="speed-avg">0.0 tok/s</dd>
              </div>
              <div class="speed-stat-item">
                <dt>Đỉnh 5 giờ</dt>
                <dd id="speed-peak">0.0 tok/s</dd>
              </div>
              <div class="speed-stat-item">
                <dt>Lưu lượng 5 phút</dt>
                <dd id="speed-5m">0 tok/m</dd>
              </div>
            </dl>
          </div>
        </div>
        <div class="sparkline-wrap">
          <div class="sparkline-head">
            <span class="section-label">Nhịp tốc độ gần nhất</span>
            <span class="section-hint" id="speed-sample-note">0 mẫu 24h</span>
          </div>
          <svg class="sparkline-svg" id="speed-sparkline" viewBox="0 0 280 42" preserveAspectRatio="none" aria-label="Biểu đồ lịch sử tốc độ token mỗi giây"></svg>
        </div>
      </div>

      <div class="pixel-panel">
        <canvas class="pixel-canvas" id="pixel-stage" width="204" height="82" aria-label="Bé Turbo pixel đang theo dõi đồng hồ quota, bấm để tương tác"></canvas>
        <div class="pixel-caption-row">
          <span class="pixel-speech" id="pixel-speech-text">Bé Turbo đang gác đồng hồ quota cho anh…</span>
          <span class="pixel-tap-hint">Bấm thả tim</span>
        </div>
      </div>
    </section>

    <section class="quota-section" aria-label="Đồng hồ quota theo nhóm model">
      <div class="section-toolbar">
        <h2 class="section-title" id="quota-section-title">Đồng hồ Quota cửa sổ 5 giờ</h2>
        <span class="section-hint" id="quota-mode-hint">Token đo thật từ transcript, bấm Đồng bộ để khớp % tài khoản</span>
      </div>
      <div class="quota-grid" id="quota-grid">
        <div class="skeleton-row" aria-hidden="true"></div>
        <div class="skeleton-row" aria-hidden="true"></div>
        <div class="skeleton-row" aria-hidden="true"></div>
      </div>
    </section>

    <section class="calib-panel" id="calib-panel" hidden aria-label="Hiệu chỉnh quota nhóm model">
      <div class="calib-head">
        <h3 class="calib-title" id="calib-title">Hiệu chỉnh Quota</h3>
        <button class="ctrl-btn" id="calib-close-btn" type="button">Đóng</button>
      </div>
      <form class="calib-form" id="calib-form">
        <input type="hidden" id="calib-bucket-id" value="" />
        <div class="calib-fields">
          <label class="field-group">
            <span>Phần trăm còn lại hiện tại (%)</span>
            <input class="field-input" id="calib-pct" type="number" min="0" max="100" step="0.1" placeholder="Ví dụ: 84.5" />
          </label>
          <label class="field-group">
            <span>Hạn mức cửa sổ 5 giờ (tokens)</span>
            <input class="field-input" id="calib-limit-5h" type="number" min="1000" step="100000" />
          </label>
          <label class="field-group">
            <span>Hạn mức cửa sổ 7 ngày (tokens)</span>
            <input class="field-input" id="calib-limit-7d" type="number" min="1000" step="1000000" />
          </label>
        </div>
        <div class="calib-actions">
          <button class="ctrl-btn is-primary" id="calib-save-btn" type="submit">Lưu đồng bộ</button>
          <button class="ctrl-btn" id="calib-reset-btn" type="button">Đặt lại mặc định</button>
        </div>
      </form>
    </section>

    <section class="turns-section" aria-label="Lượt phản hồi gần nhất">
      <div class="section-toolbar">
        <h2 class="section-title">Nhịp lượt gần nhất</h2>
        <span class="section-hint" id="turns-scan-meta">Chưa quét</span>
      </div>
      <div class="table-wrap">
        <table class="turns-table">
          <thead>
            <tr>
              <th scope="col">Giờ</th>
              <th scope="col">Model</th>
              <th scope="col" class="num">Output</th>
              <th scope="col" class="num">Thời gian</th>
              <th scope="col" class="num">Tốc độ</th>
            </tr>
          </thead>
          <tbody id="turns-tbody">
            <tr>
              <td colspan="5" class="empty-cell">Đang chờ dữ liệu lượt phản hồi…</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
${bundledJs}
  </script>
</body>
</html>
`;

  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const outPath = path.join(distDir, 'hud.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Built ${outPath} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
