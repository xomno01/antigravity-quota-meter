import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WIN_5H_MS = 5 * 3600 * 1000;
const WIN_7D_MS = 7 * 86400 * 1000;
const RECENT_TURN_HORIZON_MS = 8 * 86400 * 1000;
const ACTIVE_WINDOW_MS = 25 * 1000;
const BURST_WINDOW_MS = 12 * 1000;
const SPEED_CURRENT_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_ACCOUNT_ID = 'acc-default';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOCAL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toLocalDate(msOrIso) {
  if (!msOrIso) return 'unknown';
  const d = typeof msOrIso === 'number' ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return dateFormatter.format(d); // YYYY-MM-DD
}

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
    return Number(hhmm[1]) * 3600 + Number(hhmm[2]) * 60 + Number(hhmm[3] || 0);
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

function sanitizeLabel(label, fallback = 'Tài khoản') {
  const clean = String(label || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return clean || fallback;
}

function makeAccountId(label) {
  const slug = String(label || 'acc')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'acc';
  const suffix = (Date.now() % 100000).toString(36);
  return `acc-${slug}-${suffix}`;
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

function sanitizeBucketsMap(rawBuckets) {
  const out = {};
  if (!rawBuckets || typeof rawBuckets !== 'object') return out;
  for (const [id, cfg] of Object.entries(rawBuckets)) {
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
    out[id] = entry;
  }
  return out;
}

export function resolveAccountForTimestamp(atMs, switchLog) {
  if (!Array.isArray(switchLog) || switchLog.length === 0) {
    return DEFAULT_ACCOUNT_ID;
  }
  let matched = switchLog[0].accountId || DEFAULT_ACCOUNT_ID;
  for (let i = 1; i < switchLog.length; i++) {
    if (switchLog[i].fromMs <= atMs) {
      matched = switchLog[i].accountId;
    } else {
      break;
    }
  }
  return matched;
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
    this.cacheFile = path.join(this.dataDir, 'transcript-cache.v2.json');

    /** @type {Map<string, any>} */
    this.fileCache = new Map();
    this._loadDiskCache();
  }

  _loadDiskCache() {
    try {
      if (!fs.existsSync(this.cacheFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (raw && raw.version === 2 && raw.entries && typeof raw.entries === 'object') {
        for (const [id, entry] of Object.entries(raw.entries)) {
          this.fileCache.set(id, entry);
        }
      }
    } catch {
      // Ignore corrupt cache and rebuild cleanly
    }
  }

  _saveDiskCache() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const entries = Object.fromEntries(this.fileCache.entries());
      const tmp = `${this.cacheFile}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 2, tz: LOCAL_TZ, entries }), 'utf8');
      fs.renameSync(tmp, this.cacheFile);
    } catch {
      // Non-fatal
    }
  }

  loadConfig() {
    const defaultConfig = {
      version: 3,
      activeAccountId: DEFAULT_ACCOUNT_ID,
      accounts: {
        [DEFAULT_ACCOUNT_ID]: {
          id: DEFAULT_ACCOUNT_ID,
          label: 'Acc chính',
          createdAtMs: 0,
          buckets: {},
        },
      },
      switchLog: [{ accountId: DEFAULT_ACCOUNT_ID, fromMs: 0 }],
    };

    try {
      if (!fs.existsSync(this.configFile)) return defaultConfig;
      const parsed = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return defaultConfig;

      // Migrate v1/v2 config seamlessly into accounts[DEFAULT_ACCOUNT_ID]
      if (!parsed.accounts || typeof parsed.accounts !== 'object') {
        const migratedBuckets = sanitizeBucketsMap(parsed.buckets);
        defaultConfig.accounts[DEFAULT_ACCOUNT_ID].buckets = migratedBuckets;
        return defaultConfig;
      }

      const accounts = {};
      for (const [id, rawAcc] of Object.entries(parsed.accounts)) {
        if (!rawAcc || typeof rawAcc !== 'object' || !/^[a-z0-9_-]{3,48}$/.test(id)) continue;
        accounts[id] = {
          id,
          label: sanitizeLabel(rawAcc.label, id === DEFAULT_ACCOUNT_ID ? 'Acc chính' : id),
          createdAtMs: Number.isFinite(rawAcc.createdAtMs) ? rawAcc.createdAtMs : 0,
          buckets: sanitizeBucketsMap(rawAcc.buckets),
        };
      }

      if (!accounts[DEFAULT_ACCOUNT_ID]) {
        accounts[DEFAULT_ACCOUNT_ID] = defaultConfig.accounts[DEFAULT_ACCOUNT_ID];
      }

      const activeAccountId =
        typeof parsed.activeAccountId === 'string' && accounts[parsed.activeAccountId]
          ? parsed.activeAccountId
          : DEFAULT_ACCOUNT_ID;

      const switchLog = [];
      if (Array.isArray(parsed.switchLog)) {
        for (const seg of parsed.switchLog) {
          if (
            seg &&
            typeof seg.accountId === 'string' &&
            accounts[seg.accountId] &&
            Number.isFinite(seg.fromMs) &&
            seg.fromMs >= 0
          ) {
            switchLog.push({ accountId: seg.accountId, fromMs: seg.fromMs });
          }
        }
      }
      switchLog.sort((a, b) => a.fromMs - b.fromMs);
      if (switchLog.length === 0 || switchLog[0].fromMs > 0) {
        switchLog.unshift({ accountId: DEFAULT_ACCOUNT_ID, fromMs: 0 });
      }

      return {
        version: 3,
        activeAccountId,
        accounts,
        switchLog,
      };
    } catch {
      return defaultConfig;
    }
  }

  _writeConfig(config) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.configFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, this.configFile);
  }

  manageAccount({ action, accountId, label } = {}) {
    const config = this.loadConfig();
    const now = Date.now();

    if (action === 'create') {
      const cleanLabel = sanitizeLabel(label, `Acc ${Object.keys(config.accounts).length + 1}`);
      let newId = makeAccountId(cleanLabel);
      while (config.accounts[newId]) {
        newId = `${newId}x`;
      }
      config.accounts[newId] = {
        id: newId,
        label: cleanLabel,
        createdAtMs: now,
        buckets: {},
      };
      config.activeAccountId = newId;
      config.switchLog.push({ accountId: newId, fromMs: now });
      this._writeConfig(config);
      return config;
    }

    if (action === 'switch') {
      if (!accountId || !config.accounts[accountId]) {
        throw new Error(`Unknown accountId: ${accountId}`);
      }
      if (config.activeAccountId !== accountId) {
        config.activeAccountId = accountId;
        config.switchLog.push({ accountId, fromMs: now });
        this._writeConfig(config);
      }
      return config;
    }

    if (action === 'rename') {
      const targetId = accountId || config.activeAccountId;
      if (!config.accounts[targetId]) {
        throw new Error(`Unknown accountId: ${targetId}`);
      }
      config.accounts[targetId].label = sanitizeLabel(label, config.accounts[targetId].label);
      this._writeConfig(config);
      return config;
    }

    if (action === 'delete') {
      if (!accountId || !config.accounts[accountId]) {
        throw new Error(`Unknown accountId: ${accountId}`);
      }
      if (accountId === DEFAULT_ACCOUNT_ID || accountId === config.activeAccountId) {
        throw new Error('Cannot delete default or active account');
      }
      delete config.accounts[accountId];
      config.switchLog = config.switchLog.filter((s) => s.accountId !== accountId);
      if (config.switchLog.length === 0) {
        config.switchLog.push({ accountId: DEFAULT_ACCOUNT_ID, fromMs: 0 });
      }
      this._writeConfig(config);
      return config;
    }

    throw new Error(`Unsupported account action: ${action}`);
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
    const acc = config.accounts[config.activeAccountId];
    const cur = acc.buckets[bucketId] ? { ...acc.buckets[bucketId] } : {};

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

    acc.buckets[bucketId] = cur;
    this._writeConfig(config);
    return config;
  }

  resetConfig(bucketId) {
    const config = this.loadConfig();
    const acc = config.accounts[config.activeAccountId];
    if (bucketId) {
      if (!BUCKET_MAP.has(bucketId)) {
        throw new Error(`Invalid bucketId: ${bucketId}`);
      }
      delete acc.buckets[bucketId];
    } else {
      acc.buckets = {};
    }
    this._writeConfig(config);
    return config;
  }

  _parseTranscript(convId, filePath, stat, retainTurnsCutoffMs) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const events = [];

    let input = 0;
    let cacheRead = 0;
    let output = 0;
    let turnsCount = 0;
    let firstAtMs = 0;
    let lastAtMs = 0;
    /** @type {Record<string, { input: number, cacheRead: number, output: number, total: number, turns: number }>} */
    const byDate = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 2) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      const inTok = Number(obj.input_tokens) || 0;
      const cacheTok = Number(obj.cache_read_tokens) || 0;
      const outTok = Number(obj.output_tokens) || 0;
      const hasTokens = inTok > 0 || cacheTok > 0 || outTok > 0;
      const atMs = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;

      if (Number.isFinite(atMs)) {
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

      // Exact parity with token-usage scanner: count every entry with tokens > 0
      if (!hasTokens) continue;
      const totalTok = inTok + cacheTok + outTok;
      const dateKey = toLocalDate(obj.created_at);

      input += inTok;
      cacheRead += cacheTok;
      output += outTok;
      turnsCount += 1;

      if (Number.isFinite(atMs)) {
        if (!firstAtMs || atMs < firstAtMs) firstAtMs = atMs;
        if (!lastAtMs || atMs > lastAtMs) lastAtMs = atMs;
      }

      if (!byDate[dateKey]) {
        byDate[dateKey] = { input: 0, cacheRead: 0, output: 0, total: 0, turns: 0 };
      }
      byDate[dateKey].input += inTok;
      byDate[dateKey].cacheRead += cacheTok;
      byDate[dateKey].output += outTok;
      byDate[dateKey].total += totalTok;
      byDate[dateKey].turns += 1;
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
      if (ev.atMs < retainTurnsCutoffMs) continue;

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
      input,
      cacheRead,
      output,
      total: input + cacheRead + output,
      turnsCount,
      firstAtMs,
      lastAtMs,
      lastEventAtMs,
      lastEventType,
      activeModel,
      byDate,
      turns,
    };
  }

  _scanAllTranscripts(now, switchLog) {
    let cacheDirty = false;
    const seenIds = new Set();

    // Retain per-turn detail for turns within 8 days OR since the first account switch
    const firstSwitchMs =
      switchLog.length > 1 ? switchLog[1].fromMs : now - RECENT_TURN_HORIZON_MS;
    const retainTurnsCutoffMs = Math.min(now - RECENT_TURN_HORIZON_MS, firstSwitchMs);

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

        seenIds.add(convId);
        const cached = this.fileCache.get(convId);
        const needsTurnUpgrade =
          cached &&
          stat.mtimeMs >= retainTurnsCutoffMs &&
          !Array.isArray(cached.turns);

        if (
          cached &&
          !needsTurnUpgrade &&
          cached.mtimeMs === stat.mtimeMs &&
          cached.size === stat.size
        ) {
          continue;
        }

        try {
          const parsed = this._parseTranscript(
            convId,
            transcriptPath,
            stat,
            retainTurnsCutoffMs
          );
          this.fileCache.set(convId, parsed);
          cacheDirty = true;
        } catch {
          // Ignore unreadable file during live write
        }
      }
    }

    for (const id of [...this.fileCache.keys()]) {
      if (!seenIds.has(id)) {
        this.fileCache.delete(id);
        cacheDirty = true;
      }
    }

    if (cacheDirty) {
      this._saveDiskCache();
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

  _buildUsageAggregation(config, scope, now) {
    const today = toLocalDate(now);
    const currentMonth = today.slice(0, 7);
    const activeId = config.activeAccountId;
    const switchLog = config.switchLog;
    const isSingleDefault = switchLog.length === 1 && activeId === DEFAULT_ACCOUNT_ID;
    const firstSwitchMs = switchLog.length > 1 ? switchLog[1].fromMs : Infinity;

    const allTime = {
      input: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
      turns: 0,
      conversations: 0,
      activeDays: 0,
      cacheHitRate: 0,
    };

    const dailyMap = new Map();
    const monthlyMap = new Map();

    const addDayBucket = (dateKey, convId, stats) => {
      if (!dateKey || dateKey === 'unknown') return;
      const monthKey = dateKey.slice(0, 7);

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          month: monthKey,
          input: 0,
          cacheRead: 0,
          output: 0,
          total: 0,
          turns: 0,
          convSet: new Set(),
        });
      }
      const dm = dailyMap.get(dateKey);
      dm.input += stats.input;
      dm.cacheRead += stats.cacheRead;
      dm.output += stats.output;
      dm.total += stats.total;
      dm.turns += stats.turns;
      dm.convSet.add(convId);

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey,
          input: 0,
          cacheRead: 0,
          output: 0,
          total: 0,
          turns: 0,
          convSet: new Set(),
          daySet: new Set(),
        });
      }
      const mm = monthlyMap.get(monthKey);
      mm.input += stats.input;
      mm.cacheRead += stats.cacheRead;
      mm.output += stats.output;
      mm.total += stats.total;
      mm.turns += stats.turns;
      mm.convSet.add(convId);
      mm.daySet.add(dateKey);
    };

    for (const entry of this.fileCache.values()) {
      if (!entry.turnsCount || !entry.total) continue;

      if (scope === 'all' || isSingleDefault || entry.lastAtMs < firstSwitchMs) {
        if (scope === 'account' && activeId !== DEFAULT_ACCOUNT_ID && entry.lastAtMs < firstSwitchMs) {
          continue;
        }
        allTime.input += entry.input;
        allTime.cacheRead += entry.cacheRead;
        allTime.output += entry.output;
        allTime.total += entry.total;
        allTime.turns += entry.turnsCount;
        allTime.conversations += 1;

        for (const [dateKey, dStats] of Object.entries(entry.byDate || {})) {
          addDayBucket(dateKey, entry.convId, dStats);
        }
        continue;
      }

      // Account-scoped mixed conversation spanning switches
      const convDateMap = new Map();
      let convMatched = false;

      for (const t of entry.turns || []) {
        if (resolveAccountForTimestamp(t.atMs, switchLog) !== activeId) continue;
        convMatched = true;
        allTime.input += t.input;
        allTime.cacheRead += t.cacheRead;
        allTime.output += t.output;
        allTime.total += t.total;
        allTime.turns += 1;

        const dk = toLocalDate(t.atMs);
        if (!convDateMap.has(dk)) {
          convDateMap.set(dk, { input: 0, cacheRead: 0, output: 0, total: 0, turns: 0 });
        }
        const ds = convDateMap.get(dk);
        ds.input += t.input;
        ds.cacheRead += t.cacheRead;
        ds.output += t.output;
        ds.total += t.total;
        ds.turns += 1;
      }

      if (convMatched) {
        allTime.conversations += 1;
        for (const [dk, ds] of convDateMap.entries()) {
          addDayBucket(dk, entry.convId, ds);
        }
      }
    }

    allTime.activeDays = dailyMap.size;
    allTime.cacheHitRate = calcCacheHitRate(allTime.input, allTime.cacheRead);

    const daily = [...dailyMap.values()]
      .map((d) => ({
        date: d.date,
        month: d.month,
        input: d.input,
        cacheRead: d.cacheRead,
        output: d.output,
        total: d.total,
        turns: d.turns,
        conversations: d.convSet.size,
        cacheHitRate: calcCacheHitRate(d.input, d.cacheRead),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const monthly = [...monthlyMap.values()]
      .map((m) => ({
        month: m.month,
        input: m.input,
        cacheRead: m.cacheRead,
        output: m.output,
        total: m.total,
        turns: m.turns,
        conversations: m.convSet.size,
        activeDays: m.daySet.size,
        cacheHitRate: calcCacheHitRate(m.input, m.cacheRead),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const todaySummary = daily.find((d) => d.date === today) || {
      date: today,
      month: currentMonth,
      input: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
      turns: 0,
      conversations: 0,
      cacheHitRate: 0,
    };

    const thisMonthSummary = monthly.find((m) => m.month === currentMonth) || {
      month: currentMonth,
      input: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
      turns: 0,
      conversations: 0,
      activeDays: 0,
      cacheHitRate: 0,
    };

    return {
      scope,
      timeZone: LOCAL_TZ,
      today: todaySummary,
      thisMonth: thisMonthSummary,
      allTime,
      daily: daily.slice(0, 30),
      monthly,
    };
  }

  getSnapshot({ scope = 'account' } = {}) {
    const startMs = Date.now();
    const now = startMs;
    const normalizedScope = scope === 'all' ? 'all' : 'account';

    const config = this.loadConfig();
    this._scanAllTranscripts(now, config.switchLog);

    const activeAccount = config.accounts[config.activeAccountId];
    const turnsByBucket = new Map(MODEL_BUCKETS.map((b) => [b.id, []]));
    const allSpeedTurns = [];
    const recentTurnsAll = [];
    let freshestConv = null;
    let latestPlannerTurn = null;
    const recentHorizonCutoff = now - RECENT_TURN_HORIZON_MS;

    for (const entry of this.fileCache.values()) {
      if (entry.mtimeMs < recentHorizonCutoff && entry.lastEventAtMs < recentHorizonCutoff) {
        continue;
      }

      if (
        !freshestConv ||
        Math.max(entry.mtimeMs, entry.lastEventAtMs) >
          Math.max(freshestConv.mtimeMs, freshestConv.lastEventAtMs)
      ) {
        freshestConv = entry;
      }

      for (const t of entry.turns || []) {
        if (t.atMs < recentHorizonCutoff) continue;

        recentTurnsAll.push(t);
        if (t.tokPerSec !== null && t.atMs >= now - 86400 * 1000) {
          allSpeedTurns.push(t);
        }
        if (!latestPlannerTurn || t.atMs > latestPlannerTurn.atMs) {
          latestPlannerTurn = t;
        }

        // Only attribute turns to the active account's quota pool!
        if (resolveAccountForTimestamp(t.atMs, config.switchLog) === config.activeAccountId) {
          const list = turnsByBucket.get(t.bucketId);
          if (list) list.push(t);
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
      const bCfg = activeAccount.buckets[def.id] || {};
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

    // Check if active account needs View Usage verification
    let lastSwitchInMs = 0;
    for (const seg of config.switchLog) {
      if (seg.accountId === config.activeAccountId && seg.fromMs > lastSwitchInMs) {
        lastSwitchInMs = seg.fromMs;
      }
    }
    const geminiBucket = buckets.find((b) => b.id === 'gemini-models');
    const geminiSync5hMs = activeAccount.buckets['gemini-models']?.sync5h?.syncedAtMs || 0;
    const geminiSync7dMs = activeAccount.buckets['gemini-models']?.sync7d?.syncedAtMs || 0;
    const latestGeminiSyncMs = Math.max(geminiSync5hMs, geminiSync7dMs);
    const hasValidSync = Boolean(
      geminiBucket &&
        (geminiBucket.w5h.sourceMode === 'synced' || geminiBucket.w7d.sourceMode === 'synced')
    );
    const needsSync = !hasValidSync || (lastSwitchInMs > 0 && latestGeminiSyncMs < lastSwitchInMs);

    const usage = this._buildUsageAggregation(config, normalizedScope, now);
    const machineUsage =
      normalizedScope === 'all'
        ? usage
        : this._buildUsageAggregation(config, 'all', now);

    return {
      generatedAt: new Date(now).toISOString(),
      scanDurationMs: Date.now() - startMs,
      activityState,
      activeModel: formatModelName(activeModelId),
      activeModelId,
      activeBucketId,
      account: {
        activeId: config.activeAccountId,
        activeLabel: activeAccount.label,
        needsSync,
        lastSwitchedAt: lastSwitchInMs > 0 ? new Date(lastSwitchInMs).toISOString() : '',
        accounts: Object.values(config.accounts).map((a) => ({
          id: a.id,
          label: a.label,
          isDefault: a.id === DEFAULT_ACCOUNT_ID,
          hasSync: Boolean(
            a.buckets['gemini-models']?.sync5h || a.buckets['gemini-models']?.sync7d
          ),
        })),
      },
      usage,
      machineTotals: {
        today: machineUsage.today,
        thisMonth: machineUsage.thisMonth,
        allTime: machineUsage.allTime,
      },
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
