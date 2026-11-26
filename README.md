# Antigravity Quota & Speed Meter

Native **Antigravity MCP App** plugin (`quota-meter`) that mounts into Antigravity's **Side Pane** (`aux_pane`) and **Sidebar** (`global`) to monitor real-time **`tok/s` generation speed** and **per-model-group rolling quota clocks (5-hour & 7-day windows)**, accompanied by an interactive pixel-art telemetry cockpit (**"Bé Turbo"**).

> Plugin MCP App cho **Antigravity App**: gắn ngay vào **Side Pane** và **Sidebar Plugins** để đo tốc độ `tok/s` theo thời gian thực và đồng hồ quota 5 giờ / 7 ngày cho từng nhóm model, kèm animation pixel "Bé Turbo" dễ thương.

---

## Features / Tính năng chính

- **Live `tok/s` Analog Speedometer & Sparkline**:
  - Measures true generation throughput directly from `~/.gemini/antigravity/brain/*/transcript.jsonl` (`output_tokens` across the full turn duration, accurately spanning parallel multi-tool `GENERIC` events).
  - Displays current `tok/s`, 12-turn average, 5-hour peak, 5-minute output rate, a 24-sample sparkline, and the latest 8 turns table.
- **Per-Model-Group Quota Clocks (5h & 7d Rolling Windows)**:
  - Tracks **Gemini 4 Neon**, **Gemini 4 Hydrogen**, **Gemini Pro / Argon**, **Gemini Flash**, and **Claude & GPT**.
  - Live `HH:MM:SS` countdown timers showing when the oldest turn exits each rolling window.
  - **Quick Sync Calibration (`Đồng bộ`)**: Antigravity does not expose a public backend quota API to plugins, so token counts are measured accurately against configurable default limits (`Mốc mặc định`). Click **Đồng bộ** on any clock to enter your account's actual remaining `%` (or custom 5h/7d token limits) — persisted cleanly in `${PLUGIN_DATA}/quota-config.json` and decremented in real time as new tokens arrive.
- **Reactive Pixel-Art Cockpit ("Bé Turbo")**:
  - Procedural HTML5 Canvas pixel art (zero external images), automatically synced to Antigravity's Dark and Light themes (`prefers-reduced-motion` supported).
  - Reacts live to `idle`, `working`, `burst`, and `< 20%` low-quota states. Click the stage to pet Bé Turbo for pixel hearts, gold orbs, and an immediate telemetry refresh.

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
Antigravity discovers plugins in `~/.gemini/config/plugins/` automatically:
- **Side Pane**: Click **`+`** in the Side Pane tab bar → **Quota Meter** (or `⋯` → **Plugins** → **Quota Meter**).
- **Full Page**: Open **Plugins** in the left Sidebar → **Quota Meter**.

---

## Development / Phát triển

Requires **Node.js 20+**.

```bash
# Install dependencies
npm install

# Bundle ui-src/ into self-contained dist/hud.html
npm run build:ui

# Start MCP stdio server directly (for testing)
npm start
```

### Project Structure
```text
quota-meter/
├── plugin.json          # Antigravity plugin manifest
├── mcp_config.json      # MCP stdio server definition (meter)
├── package.json
├── assets/logo.svg      # Pixel gauge icon
├── server/
│   ├── index.mjs        # MCP server, ui:// resource & 5 tools
│   └── telemetry.mjs    # Incremental transcript scanner, tok/s & rolling window engine
├── ui-src/
│   ├── app.js           # @modelcontextprotocol/ext-apps client + 1.5s live polling
│   ├── pixel-stage.js   # Procedural pixel-art cockpit ("Bé Turbo")
│   ├── styles.css       # Theme-token CSS (dark & light)
│   └── build.mjs        # esbuild single-file bundler
└── dist/
    └── hud.html         # Prebuilt self-contained MCP App HTML
```

---

## License

MIT © [xomno01](https://github.com/xomno01)
