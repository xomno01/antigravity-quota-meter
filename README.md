# Antigravity Quota & Speed Meter

Native **Antigravity MCP App** plugin (`quota-meter`) that mounts into Antigravity's **Side Pane** (`aux_pane`) and **Sidebar** (`global`) to provide:
1. **Per-Account Isolated Quota Clocks (5h & Weekly)** — separate sync anchors, custom limits, and timestamped account switch history so switching Antigravity accounts never mixes quota or token stats.
2. **All-Time, Monthly, and Daily Token & Cache Hit Analytics** — exact `total`, `input`, `cacheRead`, `output`, and `Cache Hit %` across every conversation (with **`Acc hiện tại`** vs **`Toàn máy`** toggle).
3. **Live `tok/s` Speedometer & "Bé Turbo" Pixel Cockpit** — accurate multi-tool generation throughput, 24-sample sparkline, and reactive dark/light pixel-art companion.

---

## Features / Tính năng chính

- **Per-Account Isolation (`Tài khoản đang đo`)**:
  - Switch or create account profiles (`Đổi / Thêm acc`) directly inside the HUD.
  - Each switch records a timestamp boundary (`switchLog`) in `${PLUGIN_DATA}/quota-config.json`. Quota clocks and `Acc hiện tại` stats count only turns recorded while that account is active, and each account keeps its own `5h` and `Weekly` sync anchors.
  - Whenever you switch to an account without a valid recent sync, an alert banner reminds you to verify `View Usage` and click **Đồng bộ**.
- **Full Token & Cache Hit Statistics (Daily, Monthly, All-Time)**:
  - **Hôm nay**, **Tháng này**, **Tổng từ trước đến giờ**, and **Tỉ lệ Cache Hit %** (`cacheRead / (input + cacheRead)`), plus tabbed **Theo ngày**, **Theo tháng**, and **Nhịp tok/s** tables.
- **Shared-Pool Quota Clocks (5h & Weekly)**:
  - Matches Antigravity's 2 shared pools: **Gemini Models** and **Claude and GPT models**, showing both `5h limit` and `Weekly limit` simultaneously with live `HH:MM:SS` reset countdowns.
- **Live `tok/s` Analog Speedometer & Reactive Pixel Art ("Bé Turbo")**:
  - Scans full multi-tool `GENERIC` spans so parallel tool calls never inflate `tok/s`.
  - Click Bé Turbo's cockpit to spawn pixel hearts/coins and trigger an instant refresh.

---

## Installation / Cài đặt

### Option 1 — Via `agy` CLI
```bash
agy plugin install https://github.com/xomno01/antigravity-quota-meter
```
Then install Node dependencies inside the installed plugin folder (`~/.gemini/config/plugins/`):
```bash
npm install
```

### Option 2 — Manual Install (Global Plugin)
```bash
git clone https://github.com/xomno01/antigravity-quota-meter.git ~/.gemini/config/plugins/quota-meter
cd ~/.gemini/config/plugins/quota-meter
npm install
```
Open in Antigravity:
- **Side Pane**: Click **`+`** in the Side Pane tab bar → **Quota Meter** (or `⋯` → **Plugins** → **Quota Meter**).
- **Full Page**: Open **Plugins** in the left Sidebar → **Quota Meter**.

---

## Development / Phát triển

Requires **Node.js 20+**.

```bash
npm install
npm run build:ui
npm start
```

---

## License

MIT © [xomno01](https://github.com/xomno01)
