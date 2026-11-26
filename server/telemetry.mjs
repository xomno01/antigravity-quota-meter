import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WIN_5H_MS = 5 * 3600 * 1000;
const WIN_7D_MS = 7 * 86400 * 1000;
const STALE_FILE_CUTOFF_MS = 8 * 86400 * 1000;
const ACTIVE_WINDOW_MS = 25 * 1000;
const BURST_WINDOW_MS = 12 * 1000;
const SPEED_CURRENT_MAX_AGE_MS = 10 * 60 * 1000;

export const MODEL_BUCKETS = [
  {
    id: 'gemini-models',
    label: 'Gemini Models',
    shortLabel: 'Gemini',
    defaultLimit5h: 100_000_000,
    defaultLimit7d: 780_000_000,
    iconType: 'gemini',
  },
  {
    id: 'claude-gpt',
    label: 'Claude and GPT models',
    shortLabel: 'Claude & GPT',
    defaultLimit5h: 60_000_000,
    defaultLimit7d: 450_000_000,
    iconType: 'claude',
  },
  {
    id: 'other',
    label: 'Khác / Legacy',
    shortLabel: 'Khác',
    defaultLimit5h: 100_000_000,
    defaultLimit7d: 780_000_000,
    iconType: 'other',
  },
];

const BUCKET_MAP = new Map(MODEL_BUCKETS.map((b) => [b.id, b]));
export const VALID_BUCKET_IDS = MODEL_BUCKETS.map((b) => b.id);

export function classifyModel(modelId) {
  const m = String(modelId || '').trim();
  if (/gemini|neon|carbon|argon|hydrogen|flash|pro|ultra/i.test(m)) return 'gemini-models';
  if (/claude|sonnet|opus|haiku|gpt|\bo[134]\b/i.test(m)) return 'claude-gpt';
  return 'other';
}

export function formatModelName(modelId) {
  const raw = String(modelId || '').trim();
  if (!raw || raw === 'unknown') return 'Chưa rõ model';
  return raw
    .split('-')
    .map((part) => {
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      if (part === 'xhigh') return 'xHigh';
      if (part === 'gpt') return 'GPT';
      if (part === 'oss') return 'OSS';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function parseResetDuration(input) {
  if (typeof input === 'number' && Number.isFinite(input) && input >= 0) {
    return Math.round(input);
  }
  const str = String(input || '').trim().toLowerCase();
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
    const h = Number(hhmm[1]);
    const min = Number(hhmm[2]);
    const sec = Number(hhmm[3] || 0);
    return h * 3600 + min * 60 + sec;
  }
  return null;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function round1(val) {
  return Math.round(val * 10) / 10;
}

function calcCacheHitRate(input, cacheRead) {
  const totalIn = input + cacheRead;
  if (totalIn <= 0) return 0;
  return round1((cacheRead / totalIn) * 100);
}

function sanitizeSyncAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const pct = Number(anchor.syncedRemainingPct);
  const at = Number(anchor.syncedAtMs);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !Number.isFinite(at) || at <= 0) {
    return null;
  }
  const out = { syncedRemainingPct: round1(pct), syncedAtMs: at };
  const resetAt = Number(anchor.resetAtMs);
  if (Number.isFinite(resetAt) && resetAt > 0) {
    out.resetAtMs = resetAt;
  }
  return out;
}

export class QuotaTelemetryEngine {
  constructor(options = {}) {
    this.appDataDir =
      options.appDataDir ||
      process.env.ANTIGRAVITY_APP_DATA_DIR ||
      path.join(os.homedir(), '.gemini', 'antigravity');
    this.brainDir = path.join(this.appDataDir, 'brain');
    this.dataDir =
      options.dataDir ||
      path.join(this.appDataDir, 'plugin_data', 'quota-meter');
    this.configFile = path.join(this.dataDir, 'quota-config.json');

    /** @type {Map<string, any>} */
    this.fileCache = new Map();
  }

  loadConfig() {
    const base = { version: 2, buckets: {} };
    try {
      if (!fs.existsSync(this.configFile)) return base;
      const parsed = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.buckets !== 'object') {
        return base;
      }
      const sanitized = { version: 2, buckets: {} };
      for (const [id, cfg] of Object.entries(parsed.buckets)) {
        if (!BUCKET_MAP.has(id) || !cfg || typeof cfg !== 'object') continue;
        const entry = {};
        if (Number.isFinite(cfg.limit5h) && cfg.limit5h > 0) {
          entry.limit5h = Math.round(cfg.limit5h);
        }
        if (Number.isFinite(cfg.limit7d) && cfg.limit7d > 0) {
          entry.limit7d = Math.round(cfg.limit7d);
        }
        const s5 = sanitizeSyncAnchor(cfg.sync5h);
        if (s5) entry.sync5h = s5;
        const s7 = sanitizeSyncAnchor(cfg.sync7d);
        if (s7) entry.sync7d = s7;
        sanitized.buckets[id] = entry;
      }
      return sanitized;
    } catch {
      return base;
    }
  }

  _writeConfig(config) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.configFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, this.configFile);
  }

  saveBucketConfig({
    bucketId,
    limit5h,
    limit7d,
    syncWindow,
    syncRemainingPct,
    syncResetInSec,
  } = {}) {
    if (!BUCKET_MAP.has(bucketId)) {
      throw new Error(`Invalid bucketId: ${bucketId}`);
    }
    const config = this.loadConfig();
    const cur = config.buckets[bucketId] ? { ...config.buckets[bucketId] } : {};

    if (limit5h !== undefined && limit5h !== null) {
      const n = Number(limit5h);
      if (!Number.isFinite(n) || n <= 0) throw new Error('limit5h must be > 0');
      cur.limit5h = Math.round(n);
    }
    if (limit7d !== undefined && limit7d !== null) {
      const n = Number(limit7d);
      if (!Number.isFinite(n) || n <= 0) throw new Error('limit7d must be > 0');
      cur.limit7d = Math.round(n);
    }
    if (
      syncWindow !== undefined &&
      syncWindow !== null &&
      syncRemainingPct !== undefined &&
      syncRemainingPct !== null
    ) {
      if (syncWindow !== '5h' && syncWindow !== '7d') {
        throw new Error('syncWindow must be 5h or 7d');
      }
      const pct = Number(syncRemainingPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error('syncRemainingPct must be between 0 and 100');
      }
      const now = Date.now();
      const anchor = {
        syncedRemainingPct: round1(pct),
        syncedAtMs: now,
      };
      if (syncResetInSec !== undefined && syncResetInSec !== null) {
        const sec = Number(syncResetInSec);
        if (Number.isFinite(sec) && sec > 0) {
          anchor.resetAtMs = now + Math.round(sec) * 1000;
        }
      }
      if (syncWindow === '5h') cur.sync5h = anchor;
      else cur.sync7d = anchor;
    }

    config.buckets[bucketId] = cur;
    this._writeConfig(config);
    return config;
  }

  resetConfig(bucketId) {
    const config = this.loadConfig();
    if (bucketId) {
      if (!BUCKET_MAP.has(bucketId)) {
        throw new Error(`Invalid bucketId: ${bucketId}`);
      }
      delete config.buckets[bucketId];
    } else {
      config.buckets = {};
    }
    this._writeConfig(config);
    return config;
  }

  _parseTranscript(convId, filePath, stat) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const events = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 2) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const atMs = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;
      if (!Number.isFinite(atMs)) continue;

      const inTok = Number(obj.input_tokens) || 0;
      const cacheTok = Number(obj.cache_read_tokens) || 0;
      const outTok = Number(obj.output_tokens) || 0;
      const hasTokens = inTok > 0 || cacheTok > 0 || outTok > 0;

      events.push({
        stepIndex: obj.step_index ?? events.length,
        type: obj.type || '',
        atMs,
        createdAt: obj.created_at,
        model: obj.model || '',
        toolCallCount: Array.isArray(obj.tool_calls) ? obj.tool_calls.length : 0,
        inTok,
        cacheTok,
        outTok,
        totalTok: inTok + cacheTok + outTok,
        hasTokens,
      });
    }

    const turns = [];
    let lastEventAtMs = 0;
    let lastEventType = '';
    let activeModel = '';

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.atMs >= lastEventAtMs) {
        lastEventAtMs = ev.atMs;
        lastEventType = ev.type;
      }
      if (ev.model) activeModel = ev.model;

      if (!ev.hasTokens) continue;
      if (ev.type !== 'PLANNER_RESPONSE' && ev.totalTok === 0) continue;

      let deltaSec = null;
      let genericCount = 0;
      let maxGenericAtMs = 0;
      const maxScan = ev.toolCallCount > 0 ? ev.toolCallCount : Number.POSITIVE_INFINITY;
      for (let j = i + 1; j < events.length && genericCount < maxScan; j++) {
        if (events[j].type !== 'GENERIC') break;
        genericCount += 1;
        if (events[j].atMs > maxGenericAtMs) {
          maxGenericAtMs = events[j].atMs;
        }
      }

      if (genericCount > 0 && maxGenericAtMs > 0) {
        deltaSec = (maxGenericAtMs - ev.atMs) / 1000;
      } else {
        const next = events[i + 1];
        if (next && next.type !== 'USER_INPUT') {
          deltaSec = (next.atMs - ev.atMs) / 1000;
        } else if (i === events.length - 1) {
          deltaSec = (stat.mtimeMs - ev.atMs) / 1000;
        }
      }

      let tokPerSec = null;
      let durationSec = null;
      if (deltaSec !== null && deltaSec >= 1 && deltaSec <= 300 && ev.outTok >= 15) {
        durationSec = round1(deltaSec);
        tokPerSec = round1(ev.outTok / deltaSec);
      }

      const modelId = ev.model || activeModel || 'unknown';
      turns.push({
        convId,
        stepIndex: ev.stepIndex,
        atMs: ev.atMs,
        createdAt: ev.createdAt,
        model: modelId,
        modelLabel: formatModelName(modelId),
        bucketId: classifyModel(modelId),
        input: ev.inTok,
        cacheRead: ev.cacheTok,
        output: ev.outTok,
        total: ev.totalTok,
        tokPerSec,
        durationSec,
      });
    }

    return {
      convId,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      lastEventAtMs,
      lastEventType,
      activeModel,
      turns,
    };
  }

  _scanRecentTranscripts(now) {
    const seenIds = new Set();
    const cutoffMs = now - STALE_FILE_CUTOFF_MS;

    if (fs.existsSync(this.brainDir)) {
      const entries = fs.readdirSync(this.brainDir, { withFileTypes: true });
      for (const dirent of entries) {
        if (!dirent.isDirectory()) continue;
        const convId = dirent.name;
        const transcriptPath = path.join(
          this.brainDir,
          convId,
          '.system_generated',
          'logs',
          'transcript.jsonl'
        );

        let stat;
        try {
          stat = fs.statSync(transcriptPath);
        } catch {
          continue;
        }

        if (stat.mtimeMs < cutoffMs) {
          this.fileCache.delete(convId);
          continue;
        }

        seenIds.add(convId);
        const cached = this.fileCache.get(convId);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          continue;
        }

        try {
          const parsed = this._parseTranscript(convId, transcriptPath, stat);
          this.fileCache.set(convId, parsed);
        } catch {
          // Ignore unreadable partial files during live write
        }
      }
    }

    for (const id of [...this.fileCache.keys()]) {
      if (!seenIds.has(id)) {
        this.fileCache.delete(id);
      }
    }
  }

  _computeWindowStats(turns, bucketCfg, defaultLimit, windowMs, now, syncAnchor) {
    const limit =
      bucketCfg && Number.isFinite(bucketCfg) && bucketCfg > 0
        ? bucketCfg
        : defaultLimit;

    const hasResetAnchor = Boolean(syncAnchor && Number.isFinite(syncAnchor.resetAtMs));
    const rolledOver = Boolean(hasResetAnchor && now >= syncAnchor.resetAtMs);

    let cycleStartMs = now - windowMs;
    if (hasResetAnchor) {
      if (rolledOver) {
        // Compute current cycle start after the expired reset boundary
        const elapsedCycles = Math.floor((now - syncAnchor.resetAtMs) / windowMs);
        cycleStartMs = syncAnchor.resetAtMs + elapsedCycles * windowMs;
      } else {
        cycleStartMs = syncAnchor.resetAtMs - windowMs;
      }
    }

    const syncValid = Boolean(
      syncAnchor &&
        !rolledOver &&
        Number.isFinite(syncAnchor.syncedAtMs) &&
        syncAnchor.syncedAtMs >= cycleStartMs &&
        syncAnchor.syncedAtMs <= now
    );

    let input = 0;
    let cacheRead = 0;
    let output = 0;
    let total = 0;
    let turnCount = 0;
    let oldestAtMs = 0;
    let deltaSinceSync = 0;
    const subModelMap = new Map();

    for (const t of turns) {
      if (t.atMs < cycleStartMs) continue;
      input += t.input;
      cacheRead += t.cacheRead;
      output += t.output;
      total += t.total;
      turnCount += 1;
      if (!oldestAtMs || t.atMs < oldestAtMs) {
        oldestAtMs = t.atMs;
      }
      if (syncValid && t.atMs > syncAnchor.syncedAtMs) {
        deltaSinceSync += t.total;
      }
      const prev = subModelMap.get(t.modelLabel) || { model: t.modelLabel, total: 0, turns: 0 };
      prev.total += t.total;
      prev.turns += 1;
      subModelMap.set(t.modelLabel, prev);
    }

    const subModels = [...subModelMap.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 4);

    let nextResetInSec = 0;
    let nextResetAt = '';
    if (hasResetAnchor && !rolledOver) {
      nextResetInSec = Math.max(0, Math.round((syncAnchor.resetAtMs - now) / 1000));
      nextResetAt = new Date(syncAnchor.resetAtMs).toISOString();
    } else if (hasResetAnchor && rolledOver) {
      const nextBoundary = cycleStartMs + windowMs;
      nextResetInSec = Math.max(0, Math.round((nextBoundary - now) / 1000));
      nextResetAt = new Date(nextBoundary).toISOString();
    } else if (oldestAtMs) {
      nextResetInSec = Math.max(0, Math.round((oldestAtMs + windowMs - now) / 1000));
      nextResetAt = new Date(oldestAtMs + windowMs).toISOString();
    }

    let remainingPct;
    let usedPct;
    let sourceMode;

    if (syncValid) {
      const usedDeltaPct = (deltaSinceSync / limit) * 100;
      remainingPct = clamp(round1(syncAnchor.syncedRemainingPct - usedDeltaPct), 0, 100);
      usedPct = round1(100 - remainingPct);
      sourceMode = 'synced';
    } else {
      usedPct = round1(clamp((total / limit) * 100, 0, 100));
      remainingPct = clamp(round1(100 - usedPct), 0, 100);
      sourceMode = 'window';
    }

    return {
      limit,
      input,
      cacheRead,
      output,
      total,
      turns: turnCount,
      cacheHitRate: calcCacheHitRate(input, cacheRead),
      usedPct,
      remainingPct,
      nextResetInSec,
      nextResetAt,
      sourceMode,
      syncedAt: syncValid ? new Date(syncAnchor.syncedAtMs).toISOString() : '',
      subModels,
    };
  }

  getSnapshot() {
    const startMs = Date.now();
    const now = startMs;
    this._scanRecentTranscripts(now);
    const config = this.loadConfig();

    const turnsByBucket = new Map(MODEL_BUCKETS.map((b) => [b.id, []]));
    const allSpeedTurns = [];
    const recentTurnsAll = [];
    let freshestConv = null;
    let latestPlannerTurn = null;

    for (const entry of this.fileCache.values()) {
      if (
        !freshestConv ||
        Math.max(entry.mtimeMs, entry.lastEventAtMs) >
          Math.max(freshestConv.mtimeMs, freshestConv.lastEventAtMs)
      ) {
        freshestConv = entry;
      }

      for (const t of entry.turns) {
        const list = turnsByBucket.get(t.bucketId);
        if (list) list.push(t);
        recentTurnsAll.push(t);
        if (t.tokPerSec !== null && t.atMs >= now - 86400 * 1000) {
          allSpeedTurns.push(t);
        }
        if (!latestPlannerTurn || t.atMs > latestPlannerTurn.atMs) {
          latestPlannerTurn = t;
        }
      }
    }

    allSpeedTurns.sort((a, b) => a.atMs - b.atMs);
    recentTurnsAll.sort((a, b) => b.atMs - a.atMs);

    const speedTail = allSpeedTurns.slice(-24);
    const latestSpeedTurn = allSpeedTurns.length > 0 ? allSpeedTurns[allSpeedTurns.length - 1] : null;
    const isFreshSpeed = Boolean(
      latestSpeedTurn && now - latestSpeedTurn.atMs <= SPEED_CURRENT_MAX_AGE_MS
    );

    const avgSlice = allSpeedTurns.slice(-12);
    const avgTokPerSec =
      avgSlice.length > 0
        ? round1(avgSlice.reduce((s, t) => s + t.tokPerSec, 0) / avgSlice.length)
        : 0;

    const fiveHourSpeedTurns = allSpeedTurns.filter((t) => t.atMs >= now - WIN_5H_MS);
    const peakTokPerSec =
      fiveHourSpeedTurns.length > 0
        ? round1(Math.max(...fiveHourSpeedTurns.map((t) => t.tokPerSec)))
        : 0;

    let out5m = 0;
    const fiveMinCutoff = now - 5 * 60 * 1000;
    for (const t of recentTurnsAll) {
      if (t.atMs < fiveMinCutoff) break;
      out5m += t.output;
    }
    const tokensPerMin5m = round1(out5m / 5);

    const lastKnownTokPerSec = latestSpeedTurn ? latestSpeedTurn.tokPerSec : 0;
    const currentTokPerSec = isFreshSpeed ? lastKnownTokPerSec : 0;

    let activityState = 'idle';
    const freshestAge = freshestConv
      ? now - Math.max(freshestConv.mtimeMs, freshestConv.lastEventAtMs)
      : Infinity;
    const latestTurnAge = latestPlannerTurn ? now - latestPlannerTurn.atMs : Infinity;

    if (
      latestTurnAge <= BURST_WINDOW_MS ||
      (latestSpeedTurn &&
        now - latestSpeedTurn.atMs <= ACTIVE_WINDOW_MS &&
        latestSpeedTurn.tokPerSec >= 75)
    ) {
      activityState = 'burst';
    } else if (
      freshestAge <= ACTIVE_WINDOW_MS ||
      (freshestConv &&
        freshestAge <= 45 * 1000 &&
        (freshestConv.lastEventType === 'USER_INPUT' ||
          freshestConv.lastEventType === 'GENERIC'))
    ) {
      activityState = 'working';
    }

    const activeModelId =
      (freshestConv && freshestConv.activeModel) ||
      (latestPlannerTurn && latestPlannerTurn.model) ||
      '';
    const activeBucketId = activeModelId ? classifyModel(activeModelId) : '';

    const buckets = [];
    for (const def of MODEL_BUCKETS) {
      const bTurns = turnsByBucket.get(def.id) || [];
      const bCfg = config.buckets[def.id] || {};
      const w5h = this._computeWindowStats(
        bTurns,
        bCfg.limit5h,
        def.defaultLimit5h,
        WIN_5H_MS,
        now,
        bCfg.sync5h
      );
      const w7d = this._computeWindowStats(
        bTurns,
        bCfg.limit7d,
        def.defaultLimit7d,
        WIN_7D_MS,
        now,
        bCfg.sync7d
      );

      if (def.id === 'other' && w5h.total === 0 && !bCfg.sync5h && !bCfg.sync7d) {
        continue;
      }

      let lastUsedAt = '';
      if (bTurns.length > 0) {
        let maxAt = 0;
        for (const t of bTurns) {
          if (t.atMs > maxAt) maxAt = t.atMs;
        }
        if (maxAt > 0) lastUsedAt = new Date(maxAt).toISOString();
      }

      buckets.push({
        id: def.id,
        label: def.label,
        shortLabel: def.shortLabel,
        iconType: def.iconType,
        defaultLimit5h: def.defaultLimit5h,
        defaultLimit7d: def.defaultLimit7d,
        lastUsedAt,
        w5h,
        w7d,
      });
    }

    return {
      generatedAt: new Date(now).toISOString(),
      scanDurationMs: Date.now() - startMs,
      activityState,
      activeModel: formatModelName(activeModelId),
      activeModelId,
      activeBucketId,
      speed: {
        currentTokPerSec,
        lastKnownTokPerSec,
        avgTokPerSec,
        peakTokPerSec,
        tokensPerMin5m,
        sampleCount24h: allSpeedTurns.length,
        latestAt: latestSpeedTurn ? latestSpeedTurn.createdAt : '',
        history: speedTail.map((t) => ({
          at: t.createdAt,
          tokPerSec: t.tokPerSec,
          output: t.output,
          durationSec: t.durationSec,
          model: t.modelLabel,
          bucketId: t.bucketId,
        })),
        recentTurns: recentTurnsAll.slice(0, 10).map((t) => ({
          createdAt: t.createdAt,
          model: t.modelLabel,
          bucketId: t.bucketId,
          input: t.input,
          cacheRead: t.cacheRead,
          output: t.output,
          total: t.total,
          tokPerSec: t.tokPerSec,
          durationSec: t.durationSec,
        })),
      },
      buckets,
    };
  }
}
