import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { QuotaTelemetryEngine, VALID_BUCKET_IDS } from './telemetry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const APP_URI = 'ui://quota-meter/hud.html';
const APP_MIME_TYPE = 'text/html;profile=mcp-app';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--data-dir=')) {
      opts.dataDir = arg.slice('--data-dir='.length);
    } else if (arg === '--data-dir' && argv[i + 1]) {
      opts.dataDir = argv[++i];
    } else if (arg.startsWith('--app-data-dir=')) {
      opts.appDataDir = arg.slice('--app-data-dir='.length);
    }
  }
  return opts;
}

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
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatSummaryText(snapshot, windowKey = '5h') {
  const sp = snapshot.speed;
  const speedStr =
    sp.currentTokPerSec > 0
      ? `${sp.currentTokPerSec} tok/s (live)`
      : sp.lastKnownTokPerSec > 0
        ? `${sp.lastKnownTokPerSec} tok/s (lần gần nhất)`
        : 'Chưa có mẫu';

  const lines = [
    `Quota & Speed Meter (${windowKey === '7d' ? 'Cửa sổ 7 ngày' : 'Cửa sổ 5 giờ'})`,
    `- Tốc độ hiện tại: ${speedStr} | Trung bình: ${sp.avgTokPerSec} tok/s | Đỉnh 5h: ${sp.peakTokPerSec} tok/s | Tốc độ 5m: ${fmtCompact(sp.tokensPerMin5m)} out/phút`,
    `- Model gần nhất: ${snapshot.activeModel || 'Chưa xác định'} (trạng thái: ${snapshot.activityState})`,
  ];

  for (const b of snapshot.buckets) {
    const w = windowKey === '7d' ? b.w7d : b.w5h;
    const modeTag = w.sourceMode === 'synced' ? 'đã đồng bộ' : 'mốc mặc định';
    lines.push(
      `- ${b.label}: còn ${w.remainingPct}% (${modeTag}) | Đã dùng ${fmtCompact(w.total)} / ${fmtCompact(w.limit)} | Reset: ${fmtCountdown(w.nextResetInSec)}`
    );
  }
  return lines.join('\n');
}

function readHudHtml() {
  const htmlPath =
    process.env.QUOTA_METER_APP_HTML ||
    path.join(PLUGIN_ROOT, 'dist', 'hud.html');
  if (!fs.existsSync(htmlPath)) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:24px;"><h2>Quota Meter UI not built</h2><p>Run <code>npm run build:ui</code> in ${PLUGIN_ROOT}.</p></body></html>`;
  }
  return fs.readFileSync(htmlPath, 'utf8');
}

const cliOpts = parseArgs(process.argv.slice(2));
const engine = new QuotaTelemetryEngine({
  appDataDir: cliOpts.appDataDir,
  dataDir: cliOpts.dataDir,
});

const server = new McpServer(
  {
    name: 'quota-meter',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.registerResource(
  'Quota & Speed Meter HUD',
  APP_URI,
  {
    description: 'Real-time per-model-group quota clocks (5h & 7d) and live tokens/sec telemetry HUD with pixel-art animation.',
    mimeType: APP_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: false,
      },
    },
  },
  async () => ({
    contents: [
      {
        uri: APP_URI,
        mimeType: APP_MIME_TYPE,
        text: readHudHtml(),
        _meta: {
          ui: {
            prefersBorder: false,
          },
        },
      },
    ],
  })
);

server.registerTool(
  'open_quota_meter',
  {
    title: 'Quota Meter',
    description:
      'Open the real-time Quota & Speed Meter HUD showing per-model-group quota clocks (5-hour and 7-day rolling windows), live tokens/sec speedometer, and pixel animation.',
    inputSchema: z.object({
      window: z
        .enum(['5h', '7d'])
        .optional()
        .describe('Initial quota window to display (default: 5h)'),
      bucket: z
        .string()
        .optional()
        .describe('Optional bucket ID to highlight or calibrate'),
    }),
    _meta: {
      ui: {
        resourceUri: APP_URI,
      },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'aux_pane', title: 'Quota Meter' },
          { type: 'global', title: 'Quota Meter' },
        ],
      },
    },
  },
  async (args = {}) => {
    const windowKey = args.window === '7d' ? '7d' : '5h';
    const snapshot = engine.getSnapshot();
    return {
      content: [{ type: 'text', text: formatSummaryText(snapshot, windowKey) }],
      structuredContent: {
        initialParams: {
          window: windowKey,
          bucket: args.bucket || '',
        },
        snapshot,
      },
    };
  }
);

server.registerTool(
  'get_quota_snapshot',
  {
    title: 'Get Quota & Speed Snapshot',
    description:
      'Query real-time per-model-group quota usage (5h or 7d rolling window), reset countdowns, and live tokens/sec speed.',
    inputSchema: z.object({
      window: z
        .enum(['5h', '7d'])
        .optional()
        .describe('Window to summarize: 5h (default) or 7d'),
    }),
  },
  async (args = {}) => {
    const windowKey = args.window === '7d' ? '7d' : '5h';
    const snapshot = engine.getSnapshot();
    return {
      content: [{ type: 'text', text: formatSummaryText(snapshot, windowKey) }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_poll_telemetry',
  {
    title: 'Poll Live Telemetry',
    description: 'Internal app-only tool to poll live quota and token/s telemetry.',
    inputSchema: z.object({}),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async () => {
    const snapshot = engine.getSnapshot();
    return {
      content: [{ type: 'text', text: 'OK' }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_save_quota_config',
  {
    title: 'Save Quota Calibration',
    description: 'Internal app-only tool to calibrate remaining quota % or token limits per model bucket.',
    inputSchema: z.object({
      bucketId: z.enum(VALID_BUCKET_IDS),
      limit5h: z.number().positive().optional(),
      limit7d: z.number().positive().optional(),
      syncWindow: z.enum(['5h', '7d']).optional(),
      syncRemainingPct: z.number().min(0).max(100).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args) => {
    engine.saveBucketConfig(args);
    const snapshot = engine.getSnapshot();
    return {
      content: [{ type: 'text', text: 'Saved' }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_reset_quota_config',
  {
    title: 'Reset Quota Calibration',
    description: 'Internal app-only tool to reset quota calibration for one or all model buckets.',
    inputSchema: z.object({
      bucketId: z.enum(VALID_BUCKET_IDS).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args = {}) => {
    engine.resetConfig(args.bucketId);
    const snapshot = engine.getSnapshot();
    return {
      content: [{ type: 'text', text: 'Reset' }],
      structuredContent: snapshot,
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[quota-meter] Fatal error: ${err?.stack || err}\n`);
  process.exit(1);
});
