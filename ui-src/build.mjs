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
  <meta name="description" content="Đồng hồ đo quota theo từng tài khoản, tốc độ token/s realtime và thống kê token ngày, tháng, tổng kèm tỷ lệ Cache Hit của Antigravity." />
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
        <button class="ctrl-btn is-live" id="live-toggle-btn" type="button" aria-pressed="true">Live 1.5s</button>
        <button class="ctrl-btn" id="refresh-btn" type="button" aria-label="Làm mới dữ liệu">Làm mới</button>
      </div>
    </header>

    <section class="account-bar" aria-label="Quản lý tài khoản và phạm vi thống kê">
      <div class="account-left">
        <label class="account-select-wrap">
          <span class="account-label">Tài khoản đang đo</span>
          <select class="field-input account-select" id="account-select" aria-label="Chọn tài khoản Antigravity"></select>
        </label>
        <button class="ctrl-btn" id="add-account-btn" type="button">Đổi / Thêm acc</button>
      </div>
      <div class="scope-switch" role="tablist" aria-label="Phạm vi thống kê token">
        <button class="switch-btn" role="tab" type="button" data-scope="account" aria-selected="true">Acc hiện tại</button>
        <button class="switch-btn" role="tab" type="button" data-scope="all" aria-selected="false">Toàn máy</button>
      </div>
    </section>

    <section class="new-account-panel" id="new-account-panel" hidden aria-label="Tạo hoặc chuyển sang tài khoản mới">
      <form class="new-account-form" id="new-account-form">
        <label class="field-group new-account-field">
          <span>Tên tài khoản mới (ví dụ: Acc bạn, Gmail 2)</span>
          <input class="field-input" id="new-account-name" type="text" maxlength="48" placeholder="Nhập tên tài khoản…" />
        </label>
        <div class="new-account-actions">
          <button class="ctrl-btn is-primary" type="submit">Tạo &amp; chuyển ngay</button>
          <button class="ctrl-btn" id="new-account-cancel" type="button">Hủy</button>
        </div>
      </form>
    </section>

    <section class="sync-alert-banner" id="sync-alert-banner" hidden role="status">
      <span id="sync-alert-text">Bạn vừa đổi sang tài khoản khác hoặc chưa kiểm tra lại quota. Hãy mở View Usage rồi bấm Đồng bộ để tránh lệch số.</span>
      <button class="ctrl-btn" id="sync-alert-btn" type="button">Kiểm tra &amp; Đồng bộ</button>
    </section>

    <section class="error-banner" id="error-banner" hidden role="alert">
      <span id="error-text">Không đọc được dữ liệu từ máy chủ MCP.</span>
      <button class="ctrl-btn" id="retry-btn" type="button">Thử lại</button>
    </section>

    <section class="cockpit-grid" aria-label="Buồng lái tốc độ và nhân vật pixel">
      <div class="speed-panel">
        <div class="speed-dial-wrap">
          <svg class="speed-gauge-svg" viewBox="0 0 180 122" aria-label="Đồng hồ tốc độ token mỗi giây">
            <path class="gauge-arc-track" d="M 24 88 A 70 70 0 1 1 156 88" />
            <path class="gauge-arc-active" id="speed-arc" d="M 24 88 A 70 70 0 1 1 156 88" />
            <g class="gauge-needle" id="speed-needle">
              <line x1="90" y1="72" x2="90" y2="30" />
              <circle cx="90" cy="72" r="4.5" />
            </g>
            <text class="gauge-readout-val" x="90" y="99" text-anchor="middle" id="speed-current">0.0</text>
            <text class="gauge-readout-unit" x="90" y="115" text-anchor="middle">tok/s</text>
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

    <section class="usage-section" aria-label="Thống kê token ngày, tháng, tổng và Cache Hit">
      <div class="section-toolbar">
        <h2 class="section-title" id="usage-section-title">Thống kê Token &amp; Cache Hit</h2>
        <span class="section-hint" id="usage-scope-hint">Đo chính xác từ transcript của tài khoản đang chọn</span>
      </div>
      <div class="kpi-strip">
        <article class="kpi-tile">
          <div class="kpi-head">
            <span class="kpi-label" id="kpi-today-label">Hôm nay</span>
            <span class="kpi-badge" id="kpi-today-cache">Cache 0%</span>
          </div>
          <span class="kpi-value" id="kpi-today-total">0</span>
          <span class="kpi-breakdown" id="kpi-today-breakdown">In 0 | Cache 0 | Out 0</span>
        </article>
        <article class="kpi-tile">
          <div class="kpi-head">
            <span class="kpi-label" id="kpi-month-label">Tháng này</span>
            <span class="kpi-badge" id="kpi-month-cache">Cache 0%</span>
          </div>
          <span class="kpi-value" id="kpi-month-total">0</span>
          <span class="kpi-breakdown" id="kpi-month-breakdown">In 0 | Cache 0 | Out 0</span>
        </article>
        <article class="kpi-tile">
          <div class="kpi-head">
            <span class="kpi-label">Tổng từ trước đến giờ</span>
            <span class="kpi-badge" id="kpi-all-convs">0 hội thoại</span>
          </div>
          <span class="kpi-value" id="kpi-all-total">0</span>
          <span class="kpi-breakdown" id="kpi-all-breakdown">In 0 | Cache 0 | Out 0</span>
        </article>
        <article class="kpi-tile">
          <div class="kpi-head">
            <span class="kpi-label">Tỉ lệ Cache Hit</span>
            <span class="kpi-badge" id="kpi-cache-days">0 ngày</span>
          </div>
          <span class="kpi-value" id="kpi-cache-rate">0%</span>
          <div class="composition-track" aria-hidden="true">
            <span class="comp-seg comp-in" id="comp-bar-in"></span>
            <span class="comp-seg comp-cache" id="comp-bar-cache"></span>
            <span class="comp-seg comp-out" id="comp-bar-out"></span>
          </div>
          <span class="kpi-breakdown" id="kpi-cache-detail">Cache read trên tổng input</span>
        </article>
      </div>
    </section>

    <section class="quota-section" aria-label="Đồng hồ quota dùng chung theo tài khoản">
      <div class="section-toolbar">
        <h2 class="section-title" id="quota-section-title">Đồng hồ Quota theo tài khoản</h2>
        <span class="section-hint" id="quota-mode-hint">Tách riêng từng acc, bấm Đồng bộ để khớp % từ View Usage</span>
      </div>
      <div class="quota-grid" id="quota-grid">
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
            <span>Khung cần đồng bộ</span>
            <select class="field-input" id="calib-window">
              <option value="5h">Cửa sổ 5 giờ (5h limit)</option>
              <option value="7d">Cửa sổ Tuần (Weekly limit)</option>
            </select>
          </label>
          <label class="field-group">
            <span>Phần trăm còn lại (%)</span>
            <input class="field-input" id="calib-pct" type="number" min="0" max="100" step="0.1" placeholder="Ví dụ: 93" />
          </label>
          <label class="field-group">
            <span>Reset sau (ví dụ 3h 47m, 6d 15h)</span>
            <input class="field-input" id="calib-reset" type="text" placeholder="3h 47m hoặc 6d 15h" />
          </label>
          <label class="field-group">
            <span>Hạn mức 5h / Tuần (tokens)</span>
            <div class="limit-pair">
              <input class="field-input" id="calib-limit-5h" type="number" min="1000" step="1000000" aria-label="Hạn mức 5 giờ" />
              <input class="field-input" id="calib-limit-7d" type="number" min="1000" step="10000000" aria-label="Hạn mức tuần" />
            </div>
          </label>
        </div>
        <div class="calib-actions">
          <button class="ctrl-btn is-primary" id="calib-save-btn" type="submit">Lưu đồng bộ</button>
          <button class="ctrl-btn" id="calib-reset-btn" type="button">Đặt lại mặc định</button>
        </div>
      </form>
    </section>

    <section class="turns-section" aria-label="Bảng chi tiết theo ngày, tháng và nhịp tốc độ">
      <div class="section-toolbar">
        <div class="history-tabs" role="tablist" aria-label="Chế độ xem chi tiết">
          <button class="switch-btn" role="tab" type="button" data-history="daily" aria-selected="true">Theo ngày</button>
          <button class="switch-btn" role="tab" type="button" data-history="monthly" aria-selected="false">Theo tháng</button>
          <button class="switch-btn" role="tab" type="button" data-history="turns" aria-selected="false">Nhịp tok/s</button>
        </div>
        <span class="section-hint" id="turns-scan-meta">Chưa quét</span>
      </div>
      <div class="table-wrap">
        <table class="turns-table">
          <thead id="history-thead">
            <tr>
              <th scope="col">Ngày</th>
              <th scope="col" class="num">Tổng</th>
              <th scope="col" class="num">Input mới</th>
              <th scope="col" class="num">Cache Read</th>
              <th scope="col" class="num">Output</th>
              <th scope="col" class="num">Cache Hit</th>
              <th scope="col" class="num">Lượt</th>
            </tr>
          </thead>
          <tbody id="history-tbody">
            <tr>
              <td colspan="7" class="empty-cell">Đang chờ dữ liệu thống kê…</td>
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
