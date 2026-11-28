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

function formatSummaryText(snapshot) {
  const sp = snapshot.speed;
  const acc = snapshot.account;
  const u = snapshot.usage;
  const speedStr =
    sp.currentTokPerSec > 0
      ? `${sp.currentTokPerSec} tok/s (live)`
      : sp.lastKnownTokPerSec > 0
        ? `${sp.lastKnownTokPerSec} tok/s (lần gần nhất)`
        : 'Chưa có mẫu';

  const syncWarn = acc.needsSync
    ? 'CẦN KIỂM TRA LẠI View Usage trên acc này'
    : 'Đã đồng bộ trên acc này';

  const lines = [
    `Quota & Speed Meter (${acc.activeLabel}, ${syncWarn})`,
    `- Tốc độ hiện tại: ${speedStr} | Trung bình: ${sp.avgTokPerSec} tok/s | Đỉnh 5h: ${sp.peakTokPerSec} tok/s | Tốc độ 5m: ${fmtCompact(sp.tokensPerMin5m)} out/phút`,
  ];

  for (const b of snapshot.buckets) {
    const tag5h = b.w5h.sourceMode === 'synced' ? 'đã đồng bộ' : 'chưa đồng bộ';
    const tag7d = b.w7d.sourceMode === 'synced' ? 'đã đồng bộ' : 'chưa đồng bộ';
    lines.push(
      `- ${b.label}: 5h còn ${b.w5h.remainingPct}% (${tag5h}, ${fmtCompact(b.w5h.quotaUnits)} eq / ${fmtCompact(b.w5h.limit)}, reset ${fmtCountdown(b.w5h.nextResetInSec)}) | Tuần còn ${b.w7d.remainingPct}% (${tag7d}, ${fmtCompact(b.w7d.quotaUnits)} eq / ${fmtCompact(b.w7d.limit)}, reset ${fmtCountdown(b.w7d.nextResetInSec)})`
    );
  }

  const scopeLabel = u.scope === 'all' ? 'Toàn máy' : acc.activeLabel;
  lines.push(`Thống kê Token & Cache Hit (${scopeLabel}):`);
  lines.push(
    `- Hôm nay (${u.today.date}): ${fmtCompact(u.today.total)} (Input mới ${fmtCompact(u.today.input)} | Cache Read ${fmtCompact(u.today.cacheRead)} | Output ${fmtCompact(u.today.output)} | Cache Hit ${u.today.cacheHitRate}% | ${u.today.turns} lượt)`
  );
  lines.push(
    `- Tháng này (${u.thisMonth.month}): ${fmtCompact(u.thisMonth.total)} (Input mới ${fmtCompact(u.thisMonth.input)} | Cache Read ${fmtCompact(u.thisMonth.cacheRead)} | Output ${fmtCompact(u.thisMonth.output)} | Cache Hit ${u.thisMonth.cacheHitRate}% | ${u.thisMonth.activeDays} ngày)`
  );
  lines.push(
    `- Tổng từ trước đến giờ: ${fmtCompact(u.allTime.total)} (Input mới ${fmtCompact(u.allTime.input)} | Cache Read ${fmtCompact(u.allTime.cacheRead)} | Output ${fmtCompact(u.allTime.output)} | Cache Hit ${u.allTime.cacheHitRate}% | ${u.allTime.conversations} hội thoại, ${u.allTime.activeDays} ngày)`
  );

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
    version: '2.0.0',
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
    description: 'Real-time per-account quota clocks, live tokens/sec telemetry, and all-time/monthly/daily token & cache hit analytics.',
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
      'Open the real-time Quota & Speed Meter HUD with per-account quota isolation, live tok/s speedometer, and daily/monthly/all-time token & cache hit statistics.',
    inputSchema: z.object({
      bucket: z
        .string()
        .optional()
        .describe('Optional bucket ID to highlight or calibrate'),
      scope: z
        .enum(['account', 'all'])
        .optional()
        .describe('Usage aggregation scope: account (default) or all'),
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
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
    return {
      content: [{ type: 'text', text: formatSummaryText(snapshot) }],
      structuredContent: {
        initialParams: {
          bucket: args.bucket || '',
          scope,
        },
        snapshot,
      },
    };
  }
);

server.registerTool(
  'get_quota_snapshot',
  {
    title: 'Get Quota & Token Usage Snapshot',
    description:
      'Query per-account quota clocks, live tokens/sec, and exact today/monthly/all-time token usage with cache hit percentage.',
    inputSchema: z.object({
      scope: z
        .enum(['account', 'all'])
        .optional()
        .describe('Usage scope: account (current profile) or all (all transcripts on machine)'),
    }),
  },
  async (args = {}) => {
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
    return {
      content: [{ type: 'text', text: formatSummaryText(snapshot) }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_poll_telemetry',
  {
    title: 'Poll Live Telemetry',
    description: 'Internal app-only tool to poll live quota, usage stats, and token/s telemetry.',
    inputSchema: z.object({
      scope: z.enum(['account', 'all']).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args = {}) => {
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
    return {
      content: [{ type: 'text', text: 'OK' }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_manage_account',
  {
    title: 'Manage Account Profile',
    description: 'Internal app-only tool to create, switch, rename, or delete isolated account profiles.',
    inputSchema: z.object({
      action: z.enum(['create', 'switch', 'rename', 'delete']),
      accountId: z.string().optional(),
      label: z.string().optional(),
      scope: z.enum(['account', 'all']).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args) => {
    engine.manageAccount(args);
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
    return {
      content: [{ type: 'text', text: 'Account updated' }],
      structuredContent: snapshot,
    };
  }
);

server.registerTool(
  'app_save_quota_config',
  {
    title: 'Save Quota Calibration',
    description: 'Internal app-only tool to calibrate remaining quota %, reset countdown, or token limits for the active account.',
    inputSchema: z.object({
      bucketId: z.enum(VALID_BUCKET_IDS),
      limit5h: z.number().positive().optional(),
      limit7d: z.number().positive().optional(),
      syncWindow: z.enum(['5h', '7d']).optional(),
      syncRemainingPct: z.number().min(0).max(100).optional(),
      syncResetInSec: z.number().nonnegative().optional(),
      scope: z.enum(['account', 'all']).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args) => {
    engine.saveBucketConfig(args);
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
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
    description: 'Internal app-only tool to reset quota calibration for one or all pools on the active account.',
    inputSchema: z.object({
      bucketId: z.enum(VALID_BUCKET_IDS).optional(),
      scope: z.enum(['account', 'all']).optional(),
    }),
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  async (args = {}) => {
    engine.resetConfig(args.bucketId);
    const scope = args.scope === 'all' ? 'all' : 'account';
    const snapshot = engine.getSnapshot({ scope });
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
