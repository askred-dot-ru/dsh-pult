/**
 * dsh-pult — Host half.
 *
 * One bundle for the MCP column of the right sidebar. It carries the two route
 * families the column needs, unchanged, so the Browser half keeps calling the
 * same document-relative paths:
 *
 *   api/mcp-docker-status          the container/server snapshot  (+ /action)
 *   api/cfsmcp2-contexts           the cfsmcp2 catalogue          (+ /action)
 *   api/lmstudio                   the models LM Studio has loaded
 *
 * Each half keeps its own implementation in its own closure: they were separate
 * bundles, they read their own configuration keys, and nothing they do overlaps.
 * The configuration of the single row is the union of both — each half ignores
 * the keys it does not know.
 */
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';

function makeDockerHalf(ctx, config) {
/**
 * MCP servers half of dsh-pult.
 *
 * Owns two authenticated exact Fetch routes:
 *
 *   GET  /api/mcp-docker-status          a point-in-time JSON snapshot of the
 *                                        Docker state of the tracked containers,
 *                                        and whether each tracked MCP server is
 *                                        connected to the current session — that
 *                                        is, whether its `mcp__<server>__*` tools
 *                                        are registered in the tool registry
 *                                        this session reads. The MCP client
 *                                        registers those tools only after a
 *                                        successful connect plus discovery, and
 *                                        unregisters them once its reconnect
 *                                        budget is exhausted, so their presence
 *                                        is the session's own view of "linked".
 *   POST /api/mcp-docker-status/action   `start`, `stop` or `restart` for one
 *                                        container. The container must appear in
 *                                        the configured target list: the client
 *                                        can never name an arbitrary container.
 *
 * The browser half (`client.js`) renders the snapshot in the session's right
 * sidebar and posts the actions. That page also declares the
 * `mcp-docker-status.top` seat, which other bundles fill: the cfsmcp2 context
 * catalogue lives there, contributed by dsh-pult itself.
 *
 * @module dsh-pult
 */


/** Cordis plugin name used by loader diagnostics. */

/** Both routes are served by Connection; the tool registry is read through `ctx.get`. */

/** Authenticated exact Fetch route carrying the snapshot. */
const ROUTE_PATH = '/api/mcp-docker-status';
/** Authenticated exact Fetch route carrying container actions. */
const ACTION_PATH = '/api/mcp-docker-status/action';

/**
 * The tracked containers. Only these are reported, and only these may be
 * started, stopped or restarted.
 *
 * `container` may be null for an MCP server that runs as a native process
 * rather than in Docker (cognee, openviking): such a row reports its session
 * linkage and its endpoint probe, has no container state, and cannot be acted on.
 *
 * `server` is the `dsh-mcp-client` `serverName` — blank for a plain container,
 * which then reports no session linkage. `url` is the MCP endpoint the
 * reachability probe dials; leave it empty to skip the probe. cfsmcp2 is an
 * ordinary MCP server here: its search contexts belong to another bundle.
 *
 * `dataPaths` names the directories a native server keeps its data in, so the
 * row can report when that data last changed: the newest file mtime under them.
 * A path list is optional, and `~` is expanded.
 */
/**
 * The tracked rows when the row configuration names none. Empty on purpose: a
 * reader's servers are their own, and a shipped list would only probe dead
 * endpoints and paint the section red. List yours under `targets` in the row
 * configuration (or in the plugin card) — the shape is in README.md.
 */
const DEFAULT_TARGETS = Object.freeze([]);

/**
 * Docker executables tried in order. A GUI-launched Host inherits a minimal
 * PATH, so the absolute install locations are attempted before `PATH` lookup.
 */
const DOCKER_CANDIDATES = Object.freeze([
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/usr/bin/docker',
  'docker',
]);

/** The container actions this plugin will run. */
const ACTIONS = new Set(['start', 'stop', 'restart']);

const DEFAULT_POLL_MS = 5000;
const DEFAULT_DOCKER_TIMEOUT_MS = 8000;
const DEFAULT_PROBE_TIMEOUT_MS = 700;
const DEFAULT_ACTION_TIMEOUT_MS = 60000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** The Docker executable the last successful call used, or null. */
let resolvedDocker = null;

/** Whether `value` is a non-null, non-array object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Coerce the configured target list, falling back to the shipped one. */
function normalizeTargets(value) {
  const list = Array.isArray(value) && value.length > 0 ? value : DEFAULT_TARGETS;
  const targets = [];
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const container = typeof item.container === 'string' ? item.container.trim() : '';
    const server = typeof item.server === 'string' && item.server.trim() !== '' ? item.server.trim() : null;
    // A row is a container, a container holding an MCP server, or — for a server
    // that runs natively — neither. It needs an identity; only a container row
    // can be started, stopped or restarted.
    if (container === '' && server === null) continue;
    const identity = container === '' ? null : container;
    const label = typeof item.label === 'string' && item.label.trim() !== '' ? item.label.trim() : (server ?? identity);
    const group = typeof item.group === 'string' && item.group.trim() !== '' ? item.group.trim() : (server === null ? 'containers' : 'MCP servers');
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const dataPaths = (Array.isArray(item.dataPaths) ? item.dataPaths : [])
      .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
      .map((entry) => (entry.startsWith('~') ? join(homedir(), entry.slice(1)) : entry));
    targets.push({ container: identity, server, label, group, url, dataPaths });
  }
  return targets;
}

/** Resolve the row's raw config into complete options. */
function readConfig(config) {
  const raw = isPlainObject(config) ? config : {};
  const pollMs = Number.isFinite(raw.pollMs) && raw.pollMs >= 1000 ? raw.pollMs : DEFAULT_POLL_MS;
  const dockerTimeoutMs = Number.isFinite(raw.dockerTimeoutMs) && raw.dockerTimeoutMs >= 500 ? raw.dockerTimeoutMs : DEFAULT_DOCKER_TIMEOUT_MS;
  const probeTimeoutMs = Number.isFinite(raw.probeTimeoutMs) && raw.probeTimeoutMs >= 50 ? raw.probeTimeoutMs : DEFAULT_PROBE_TIMEOUT_MS;
  const actionTimeoutMs = Number.isFinite(raw.actionTimeoutMs) && raw.actionTimeoutMs >= 1000 ? raw.actionTimeoutMs : DEFAULT_ACTION_TIMEOUT_MS;
  const dockerPath = typeof raw.dockerPath === 'string' && raw.dockerPath.trim() !== '' ? raw.dockerPath.trim() : null;
  return {
    targets: normalizeTargets(raw.targets),
    pollMs,
    dockerTimeoutMs,
    probeTimeoutMs,
    actionTimeoutMs,
    probe: raw.probe !== false,
    actions: raw.actions !== false,
    confirmActions: raw.confirmActions === true,
    dockerPath,
  };
}

/** Run one executable and resolve with its outcome instead of rejecting. */
function execFileAsync(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      execFile(file, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, killSignal: 'SIGKILL', windowsHide: true }, (error, stdout, stderr) => {
        done({
          ok: error === null || error === undefined,
          code: error === null || error === undefined ? null : (error.code ?? null),
          error: error === null || error === undefined ? null : String(error.message ?? error),
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
        });
      });
    } catch (error) {
      done({ ok: false, code: error?.code ?? null, error: String(error?.message ?? error), stdout: '', stderr: '' });
    }
  });
}

/** The Docker executables to try, preferring the one that last worked. */
function dockerCandidates(config) {
  if (config.dockerPath !== null) return [config.dockerPath];
  if (resolvedDocker === null) return DOCKER_CANDIDATES;
  return [resolvedDocker, ...DOCKER_CANDIDATES.filter((item) => item !== resolvedDocker)];
}

/** Whether a failure means the executable itself could not be launched. */
function isMissingBinary(result) {
  return result.code === 'ENOENT' || /ENOENT/.test(result.error ?? '');
}

/**
 * Run one Docker command, trying the candidate executables in turn.
 * A binary that launched and exited non-zero is the command's own failure and
 * is reported as-is rather than retried elsewhere.
 */
async function dockerRun(config, args, timeoutMs) {
  let last = null;
  for (const file of dockerCandidates(config)) {
    const result = await execFileAsync(file, args, timeoutMs);
    if (result.ok) {
      resolvedDocker = file;
      return { ok: true, path: file, stdout: result.stdout, stderr: result.stderr, error: null };
    }
    last = { ok: false, path: file, stdout: result.stdout, stderr: result.stderr, error: result.error };
    if (resolvedDocker === file) resolvedDocker = null;
    if (!isMissingBinary(result)) return last;
  }
  return last ?? { ok: false, path: null, stdout: '', stderr: '', error: 'docker is unavailable' };
}

/**
 * Read every container's state once.
 * @returns `{ ok, error, path, rows }`, where `rows` maps a container name to its raw row.
 */
async function dockerPs(config) {
  const run = await dockerRun(config, ['ps', '-a', '--format', '{{json .}}'], config.dockerTimeoutMs);
  if (!run.ok) {
    const detail = (run.stderr ?? '').trim();
    return { ok: false, error: run.error ?? (detail === '' ? 'docker ps failed' : detail), path: run.path, rows: new Map() };
  }
  const rows = new Map();
  for (const line of run.stdout.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    let row;
    try {
      row = JSON.parse(text);
    } catch {
      continue;
    }
    if (isPlainObject(row) && typeof row.Names === 'string') rows.set(row.Names, row);
  }
  return { ok: true, error: null, path: run.path, rows };
}

/** Split an MCP endpoint URL into the host and port the probe dials. */
function endpointOf(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
    return { host: parsed.hostname, port: Number.isFinite(port) ? port : null };
  } catch {
    return null;
  }
}

/** Resolve true when a TCP connection to `host:port` completes inside the deadline. */
function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = connect({ host, port });
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Count, per tracked server, the `mcp__<server>__*` tools registered in the
 * global tool view. Each server name is matched as an explicit prefix, so a
 * raw tool name containing `__` cannot be mis-split.
 */
function mcpToolCounts(ctx, servers) {
  const counts = new Map();
  let total = 0;
  try {
    const tools = ctx.get('tools');
    const schemas = tools !== undefined && tools !== null && typeof tools.schemas === 'function' ? tools.schemas() : undefined;
    if (Array.isArray(schemas)) {
      for (const schema of schemas) {
        const toolName = isPlainObject(schema) ? schema.name : undefined;
        if (typeof toolName !== 'string') continue;
        for (const server of servers) {
          if (!toolName.startsWith(`mcp__${server}__`)) continue;
          counts.set(server, (counts.get(server) ?? 0) + 1);
          total += 1;
          break;
        }
      }
    }
  } catch {
    // A missing or restricted registry leaves every server reported as unlinked.
  }
  return { counts, total };
}

/** How long a data-age reading is reused, so a poll does not re-walk the store. */
const DATA_AGE_TTL_MS = 60000;
/** A safety stop for a pathologically large data directory. */
const DATA_AGE_MAX_FILES = 20000;
/** Data root list to `{ at, value }`, so repeated polls stay cheap. */
const dataAgeCache = new Map();

/** Every regular file under `dir`, capped, ignoring anything unreadable. */
async function filesUnder(dir, state) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.count >= DATA_AGE_MAX_FILES) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await filesUnder(full, state);
      continue;
    }
    if (!entry.isFile()) continue;
    state.files.push(full);
    state.count += 1;
  }
}

/**
 * When the data under `dataPaths` last changed: the newest file mtime, as an
 * ISO timestamp, or null when the paths hold nothing readable.
 *
 * A native MCP server keeps its store on disk, so the newest file's mtime is the
 * honest answer to "when was this updated" — its process may have been running
 * for days without writing anything. The reading is cached briefly: a walk of a
 * few thousand files is not something to repeat on every five-second poll.
 */
async function dataUpdatedAt(dataPaths, timeoutMs) {
  if (dataPaths.length === 0) return null;
  const key = dataPaths.join('\u0000');
  const now = Date.now();
  const cached = dataAgeCache.get(key);
  if (cached !== undefined && now - cached.at < DATA_AGE_TTL_MS) return cached.value;

  const state = { files: [], count: 0 };
  for (const dir of dataPaths) await filesUnder(dir, state);

  let newest = 0;
  const stamps = await Promise.all(state.files.map((file) => stat(file).then((info) => info.mtimeMs, () => 0)));
  for (const stamp of stamps) if (stamp > newest) newest = stamp;

  const value = newest === 0 ? null : new Date(newest).toISOString();
  dataAgeCache.set(key, { at: now, value });
  return value;
}

/** Project one raw Docker row onto the reported state fields. */
function containerStateOf(row) {
  if (row === undefined) return { state: 'missing', health: 'none', status: 'not created' };
  const state = typeof row.State === 'string' && row.State !== '' ? row.State : 'unknown';
  const health = typeof row.HealthStatus === 'string' && row.HealthStatus !== '' ? row.HealthStatus : 'none';
  return { state, health, status: typeof row.Status === 'string' ? row.Status : '' };
}

/** Build one complete snapshot for the snapshot route. */
async function buildSnapshot(ctx, config, sessionId) {
  const docker = await dockerPs(config);
  const servers = config.targets.map((target) => target.server).filter((server) => typeof server === 'string' && server !== '');
  const { counts, total } = mcpToolCounts(ctx, servers);

  const targets = config.targets.map((target) => {
    const hasContainer = target.container !== null;
    const row = hasContainer ? docker.rows.get(target.container) : undefined;
    const container = hasContainer ? containerStateOf(row) : { state: null, health: 'none', status: '' };
    const hasServer = typeof target.server === 'string' && target.server !== '';
    const toolCount = hasServer ? (counts.get(target.server) ?? 0) : 0;
    return {
      group: target.group,
      label: target.label,
      container: target.container,
      hasContainer,
      server: target.server,
      hasServer,
      containerId: row !== undefined && typeof row.ID === 'string' ? row.ID : null,
      image: row !== undefined && typeof row.Image === 'string' ? row.Image : null,
      ports: row !== undefined && typeof row.Ports === 'string' ? row.Ports : '',
      state: container.state,
      health: container.health,
      status: container.status,
      connected: hasServer && toolCount > 0,
      toolCount,
      url: target.url,
      dataPaths: target.dataPaths,
      lastUpdate: null,
      endpointHost: null,
      endpointPort: null,
      endpointOpen: null,
    };
  });

  await Promise.all(targets.map(async (target) => {
    target.lastUpdate = await dataUpdatedAt(target.dataPaths, config.dockerTimeoutMs);
  }));

  if (config.probe) {
    await Promise.all(targets.map(async (target) => {
      if (target.url === '') return;
      // A native server has no container state to gate the probe on.
      if (target.hasContainer && target.state !== 'running') return;
      const endpoint = endpointOf(target.url);
      if (endpoint === null || endpoint.port === null) return;
      target.endpointHost = endpoint.host;
      target.endpointPort = endpoint.port;
      target.endpointOpen = await probePort(endpoint.host, endpoint.port, config.probeTimeoutMs);
    }));
  }

  const probed = targets.filter((target) => target.endpointPort !== null);
  // Running and healthy are container facts: a native server is neither, so it
  // is counted in the linked total only.
  const containers = targets.filter((target) => target.hasContainer);
  return {
    generatedAt: new Date().toISOString(),
    pollMs: config.pollMs,
    actions: config.actions,
    confirm: config.confirmActions,
    sessionId: typeof sessionId === 'string' && sessionId !== '' ? sessionId : null,
    docker: { ok: docker.ok, error: docker.error, path: docker.path },
    summary: {
      total: containers.length,
      running: containers.filter((target) => target.state === 'running').length,
      healthy: containers.filter((target) => target.health === 'healthy').length,
      mcpTotal: servers.length,
      connected: targets.filter((target) => target.connected).length,
      probeTotal: probed.length,
      reachable: probed.filter((target) => target.endpointOpen === true).length,
      mcpTools: total,
    },
    targets,
  };
}

/** Answer with a JSON response. */
function json(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Run one container action named by the request body.
 * @param config - resolved plugin configuration.
 * @param request - the POST request carrying `{ container, action }`.
 * @returns a JSON response; a refusal is a 4xx, a Docker failure a 502.
 */
async function runAction(config, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'the request body must be JSON' }, 400);
  }
  const container = isPlainObject(body) && typeof body.container === 'string' ? body.container : '';
  const action = isPlainObject(body) && typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) return json({ ok: false, error: `unsupported action "${action}"` }, 400);
  if (!config.actions) return json({ ok: false, error: 'container actions are disabled in this profile' }, 403);
  // The configured target list is the only authority: a client can never name
  // an arbitrary container.
  if (!config.targets.some((target) => target.container !== null && target.container === container)) {
    return json({ ok: false, error: `container "${container}" is not in the tracked list` }, 403);
  }
  try {
    const run = await dockerRun(config, [action, container], config.actionTimeoutMs);
    if (!run.ok) {
      const detail = (run.stderr ?? '').trim() !== '' ? run.stderr.trim() : (run.error ?? 'docker command failed');
      return json({ ok: false, container, action, error: detail.slice(0, 500) }, 502);
    }
    return json({ ok: true, container, action, output: (run.stdout ?? '').trim().slice(0, 300) }, 200);
  } catch (error) {
    return json({ ok: false, container, action, error: String(error?.message ?? error).slice(0, 500) }, 500);
  }
}

/**
 * Register both routes.
 * @param ctx - Host context carrying the Connection service.
 * @param config - the row's raw configuration.
 */
function apply(ctx, config) {
  const resolved = readConfig(config);
  const connection = ctx.connection;
  if (connection === undefined || connection === null) return;

  connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId');
      return json(await buildSnapshot(ctx, resolved, sessionId), 200);
    },
  });

  connection.fetch.register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => runAction(resolved, request),
  });
}
  apply(ctx, config);
}

function makeCatalogueHalf(ctx, config) {
/**
 * cfsmcp2-contexts — Host half.
 *
 * A context in cfsmcp2 is a mandatory argument of every search call, so this
 * plugin owns the catalogue the operator picks one from. Its two authenticated
 * Fetch routes answer the panel and run the server's own catalogue actions:
 *
 *   GET  /api/cfsmcp2-contexts          the context catalogue, the per-entity
 *                                       indexing state and the server job queue
 *   POST /api/cfsmcp2-contexts/action   `import` — refresh one context from its
 *                                       own source path
 *
 * ## Which server interfaces this uses
 *
 * The catalogue and the indexing state come from the server's MCP tools —
 * `list_contexts`, `list_context_groups`, `get_indexing_status` — over one
 * reused MCP session, so a poll costs a single request.
 *
 * Three things have no MCP tool, and are read from the server's REST surface:
 *
 *   GET  /api/system/job-queue            the indexing queue
 *   GET  /api/entities                    the product name, version and tags of a
 *                                         context the catalogue does not carry,
 *                                         and the source path a refresh needs
 *   POST /api/entities/import-path        the refresh itself
 *
 * Those three are the plugin's ask of the server: either keep them stable, or
 * expose them as tools. The entity card is read only when the indexing tool
 * reports a context outside the ready set, so the steady state poll touches no
 * private endpoint except the queue.
 *
 * @module dsh-pult
 */

/** Cordis plugin name used by loader diagnostics. */

/** Both routes are served by Connection. */

/** Authenticated exact Fetch route carrying the catalogue. */
const ROUTE_PATH = '/api/cfsmcp2-contexts';
/** Authenticated exact Fetch route carrying the refresh action. */
const ACTION_PATH = '/api/cfsmcp2-contexts/action';

/** The server's MCP endpoint; its origin is the REST surface too. */
const DEFAULT_URL = 'http://127.0.0.1:8559/mcp/';
/** The revision this client speaks; the server answers the same one. */
const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * The accepted short names of the 1C products, matched case-insensitively
 * against a context synonym. 1C itself publishes no list of abbreviations — its
 * site and price lists name products in full — so these are the de-facto short
 * names the partner and developer community uses, built from the capital letters
 * of the product name plus its edition.
 *
 * The table is only ever applied to the DISPLAYED product name. A context's
 * `name` is the argument every search call must pass verbatim, so it is never
 * rewritten. A pattern is matched as a substring, longest pattern first, so a
 * specific product name is never shadowed by a general one; a synonym that
 * matches nothing (a bespoke base, an adaptation, an industry solution) is shown
 * as the server reported it.
 */
const DEFAULT_ABBREVIATIONS = Object.freeze([
  { match: 'управление производственным предприятием', abbr: 'УПП' },
  { match: 'бухгалтерия государственного учреждения', abbr: 'БГУ' },
  { match: 'зарплата и кадры государственного учреждения', abbr: 'ЗКГУ' },
  { match: 'документооборот государственного учреждения', abbr: 'ДГУ' },
  { match: 'зарплата и управление персоналом', abbr: 'ЗУП' },
  { match: 'erp управление предприятием', abbr: 'ERP' },
  { match: 'комплексная автоматизация', abbr: 'КА' },
  { match: 'управление автотранспортом', abbr: 'УАТ' },
  { match: 'управление нашей фирмой', abbr: 'УНФ' },
  { match: 'управление холдингом', abbr: 'УХ' },
  { match: 'бухгалтерия предприятия', abbr: 'БП' },
  { match: 'управление торговлей', abbr: 'УТ' },
  { match: 'документооборот', abbr: 'ДО' },
  { match: 'розница', abbr: 'Розница' },
]);

const DEFAULT_POLL_MS = 5000;
const DEFAULT_CONTEXTS_TTL_MS = 300000;
const DEFAULT_CONTEXTS_TIMEOUT_MS = 8000;
const DEFAULT_INDEX_TTL_MS = 3000;
const DEFAULT_IMPORT_TIMEOUT_MS = 120000;
/** How long an MCP session is reused before the client opens a fresh one. */
const SESSION_TTL_MS = 60000;
/** A failed read is cached only briefly, so a recovered server is seen quickly. */
const FAILURE_TTL_MS = 15000;
const CATALOGUE_FAILURE_TTL_MS = 30000;

/** MCP endpoint to `{ at, ttl, value }` for the context and tag catalogue. */
const catalogueCache = new Map();
/** MCP endpoint to `{ at, ttl, value }` for the indexing state and the queue. */
const indexCache = new Map();
/** MCP endpoint to `{ id, at }`, so a poll does not re-open a session. */
const sessionCache = new Map();

/** Whether `value` is a non-null, non-array object. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Read the abbreviation table: the configured one, else the shipped one. */
function readAbbreviations(raw) {
  const list = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_ABBREVIATIONS;
  const entries = [];
  for (const item of list) {
    if (!isPlainObject(item)) continue;
    const match = typeof item.match === 'string' ? item.match.trim().toLowerCase() : '';
    const abbr = typeof item.abbr === 'string' ? item.abbr.trim() : '';
    if (match === '' || abbr === '') continue;
    entries.push({ match, abbr });
  }
  // Longest first, so a specific product name is never shadowed by a general one.
  return entries.sort((left, right) => right.match.length - left.match.length);
}

/** The edition a synonym states, else the leading parts of the version. */
function editionOf(synonym, version) {
  const stated = /редакция\s*([0-9]+(?:\.[0-9]+)?)/i.exec(synonym);
  if (stated !== null) return stated[1];
  const parts = String(version ?? '').split('.').filter((part) => /^[0-9]+$/.test(part));
  return parts.length === 0 ? '' : parts.slice(0, 2).join('.');
}

/**
 * Compose the displayed product name of a context.
 *
 * The abbreviation plus the qualifiers the synonym carries (КОРП, Проф) and the
 * edition, or the server's own synonym when no product pattern matches. A
 * context's `name` is never passed here: it stays exactly as the server reports
 * it, because it is the argument every search call must carry.
 */
function contextTitle(synonym, version, abbreviations) {
  const text = typeof synonym === 'string' ? synonym : '';
  if (text === '') return '';
  const haystack = text.toLowerCase();
  const entry = abbreviations.find((candidate) => haystack.includes(candidate.match));
  if (entry === undefined) return text;
  const qualifiers = [];
  if (haystack.includes('корп')) qualifiers.push('КОРП');
  if (haystack.includes('проф')) qualifiers.push('Проф');
  return [entry.abbr, ...qualifiers, editionOf(text, version)].filter((part) => part !== '').join(' ');
}

/** Resolve the row's raw config into complete options. */
function readConfig(config) {
  const raw = isPlainObject(config) ? config : {};
  const url = typeof raw.url === 'string' && raw.url.trim() !== '' ? raw.url.trim() : DEFAULT_URL;
  const pick = (value, fallback, min) => (Number.isFinite(value) && value >= min ? value : fallback);
  return {
    url,
    abbreviations: readAbbreviations(raw.abbreviations),
    pollMs: pick(raw.pollMs, DEFAULT_POLL_MS, 1000),
    contextsTtlMs: pick(raw.contextsTtlMs, DEFAULT_CONTEXTS_TTL_MS, 0),
    contextsTimeoutMs: pick(raw.contextsTimeoutMs, DEFAULT_CONTEXTS_TIMEOUT_MS, 500),
    indexTtlMs: pick(raw.indexTtlMs, DEFAULT_INDEX_TTL_MS, 0),
    importTimeoutMs: pick(raw.importTimeoutMs, DEFAULT_IMPORT_TIMEOUT_MS, 1000)
  };
}

/** The REST origin of the server, or null when its URL is unusable. */
function restOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** GET one JSON document from the server REST surface. */
async function restJson(url, timeoutMs) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(url + ' answered HTTP ' + response.status);
  return response.json();
}

/** Read one Streamable HTTP response, which is either plain JSON or one SSE data frame. */
async function readMcpPayload(response) {
  const body = await response.text();
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    return body.trim() === '' ? null : JSON.parse(body);
  }
  let payload = null;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const frame = trimmed.slice(5).trim();
    if (frame === '') continue;
    try {
      payload = JSON.parse(frame);
    } catch {
      // A keep-alive or split frame; the last parsable document wins.
    }
  }
  return payload;
}

/** POST one JSON-RPC document and return its payload and any session id it minted. */
async function mcpPost(url, sessionId, document, timeoutMs) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId !== null) headers['mcp-session-id'] = sessionId;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(document),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error('MCP endpoint answered HTTP ' + response.status);
  return { payload: await readMcpPayload(response), sessionId: response.headers.get('mcp-session-id') };
}

/** Open one MCP session, completing the handshake the server expects. */
async function mcpOpenSession(url, timeoutMs) {
  const opened = await mcpPost(url, null, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-pult', version: '1.0.0' }
    }
  }, timeoutMs);
  try {
    await mcpPost(url, opened.sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs);
  } catch {
    // The completion notification is advisory on this server.
  }
  return opened.sessionId;
}

/** A session id to reuse, opening one when the cache is empty or stale. */
async function mcpSession(url, config, force) {
  const cached = sessionCache.get(url);
  if (!force && cached !== undefined && Date.now() - cached.at < SESSION_TTL_MS) return cached.id;
  const id = await mcpOpenSession(url, config.contextsTimeoutMs);
  sessionCache.set(url, { id, at: Date.now() });
  return id;
}

/**
 * Run one MCP tool over a reused session.
 *
 * A session the server has already expired fails the call, so the cache is
 * dropped and the call retried once on a fresh session before the failure is
 * reported.
 */
async function mcpInvoke(url, toolName, config, force) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sessionId = await mcpSession(url, config, force || attempt > 0);
    try {
      return await mcpCallTool(url, sessionId, toolName, config.contextsTimeoutMs);
    } catch (error) {
      last = error;
      sessionCache.delete(url);
    }
  }
  throw last;
}

/** Run one tool and parse the JSON document its text content carries. */
async function mcpCallTool(url, sessionId, toolName, timeoutMs) {
  const answered = await mcpPost(url, sessionId, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: {} }
  }, timeoutMs);
  const payload = answered.payload;
  if (!isPlainObject(payload)) throw new Error(toolName + ' returned no JSON-RPC payload');
  if (payload.error !== undefined && payload.error !== null) throw new Error(String(payload.error.message ?? payload.error));
  const content = isPlainObject(payload.result) && Array.isArray(payload.result.content) ? payload.result.content : [];
  const text = content.map((part) => (isPlainObject(part) && typeof part.text === 'string' ? part.text : '')).join('');
  if (text === '') throw new Error(toolName + ' returned no text content');
  return JSON.parse(text);
}

/** Project one MCP context row onto the fields the panel reads. */
function projectContext(row) {
  if (!isPlainObject(row)) return null;
  const name = typeof row.name === 'string' ? row.name : '';
  if (name === '') return null;
  return {
    id: typeof row.id === 'number' ? row.id : null,
    name,
    synonym: typeof row.synonym === 'string' ? row.synonym : '',
    version: typeof row.version === 'string' ? row.version : '',
    objectCount: typeof row.object_count === 'number' ? row.object_count : null,
    methodCount: typeof row.bsl_method_count === 'number' ? row.bsl_method_count : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string' && tag !== '') : []
  };
}

/** Project one MCP tag row onto the fields the panel reads. */
function projectTag(row) {
  if (!isPlainObject(row) || typeof row.tag !== 'string' || row.tag === '') return null;
  return {
    id: typeof row.tag_id === 'number' ? row.tag_id : null,
    tag: row.tag,
    color: typeof row.color === 'string' ? row.color : '',
    count: typeof row.context_count === 'number' ? row.context_count : null
  };
}

/**
 * Project one `get_indexing_status` row onto the fields the panel reads.
 *
 * The tool reports counts, not a percentage and not an estimate, so the
 * percentage is derived from `indexed_count` over `index_target` and there is no
 * ETA to show. The parse delta is recomposed in the shape the server itself uses
 * (`+added~changed-deleted=unchanged`).
 */
function projectIndexing(row) {
  const indexed = typeof row.indexed_count === 'number' ? row.indexed_count : null;
  const target = typeof row.index_target === 'number' ? row.index_target : null;
  const number = (value) => (typeof value === 'number' ? value : 0);
  return {
    id: typeof row.id === 'number' ? row.id : null,
    name: typeof row.name === 'string' ? row.name : '',
    status: typeof row.status === 'string' ? row.status : '',
    enabled: row.enabled === true,
    entityType: typeof row.entity_type === 'string' ? row.entity_type : '',
    sourceLocation: typeof row.source_location === 'string' ? row.source_location : '',
    sourceMode: typeof row.source_mode === 'string' ? row.source_mode : '',
    objectCount: typeof row.object_count === 'number' ? row.object_count : null,
    methodCount: typeof row.bsl_method_count === 'number' ? row.bsl_method_count : null,
    indexedCount: indexed,
    indexTarget: target,
    indexScope: typeof row.index_scope === 'string' ? row.index_scope : '',
    indexStale: row.index_stale === true,
    progressPct: indexed !== null && target !== null && target > 0 ? Math.min(100, Math.round((indexed / target) * 100)) : 0,
    progressText: indexed === null || target === null
      ? ''
      : `${indexed} / ${target}` + (indexed < target ? ` · ${target - indexed} left` : ''),
    etaSec: null,
    parseDelta: `+${number(row.parse_added)}~${number(row.parse_changed)}-${number(row.parse_deleted)}=${number(row.parse_unchanged)}`,
    errorMessage: typeof row.error_message === 'string' ? row.error_message : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : ''
  };
}

/** Project the server job queue onto the fields the panel reads. */
function projectQueue(raw) {
  if (!isPlainObject(raw)) return null;
  const item = (row) => {
    if (!isPlainObject(row)) return { entityId: null, name: String(row ?? '') };
    const name = typeof row.entity_name === 'string' && row.entity_name !== '' ? row.entity_name : (typeof row.name === 'string' ? row.name : '');
    return { entityId: typeof row.entity_id === 'number' ? row.entity_id : null, name };
  };
  const pending = Array.isArray(raw.pending) ? raw.pending : [];
  const paused = Array.isArray(raw.paused) ? raw.paused : [];
  const running = raw.running === null || raw.running === undefined ? null : item(raw.running);
  return {
    running,
    pending: pending.map(item),
    paused: paused.map(item),
    pendingCount: typeof raw.pending_count === 'number' ? raw.pending_count : pending.length,
    pausedCount: typeof raw.paused_count === 'number' ? raw.paused_count : paused.length,
    totalCount: typeof raw.total_count === 'number' ? raw.total_count : pending.length + paused.length + (running === null ? 0 : 1)
  };
}

/** Read the MCP context and tag catalogue, reusing a recent answer. */
async function readMcpCatalogue(url, config, force) {
  const now = Date.now();
  const cached = catalogueCache.get(url);
  if (!force && cached !== undefined && now - cached.at < cached.ttl) return cached.value;

  const remember = (value, ttl) => {
    catalogueCache.set(url, { at: now, ttl, value });
    return value;
  };

  const previous = isPlainObject(cached?.value) ? cached.value : { tags: [], contexts: [] };
  try {
    const contexts = await mcpInvoke(url, 'list_contexts', config, force);
    const tags = await mcpInvoke(url, 'list_context_groups', config, force);
    return remember({
      ok: true,
      error: null,
      fetchedAt: new Date().toISOString(),
      tags: (Array.isArray(tags) ? tags : []).map(projectTag).filter((tag) => tag !== null),
      contexts: (Array.isArray(contexts) ? contexts : []).map(projectContext).filter((context) => context !== null)
    }, config.contextsTtlMs);
  } catch (error) {
    return remember({
      ok: false,
      error: String(error?.message ?? error).slice(0, 300),
      fetchedAt: new Date().toISOString(),
      tags: Array.isArray(previous.tags) ? previous.tags : [],
      contexts: Array.isArray(previous.contexts) ? previous.contexts : []
    }, Math.min(config.contextsTtlMs, CATALOGUE_FAILURE_TTL_MS));
  }
}

/**
 * Read the indexing state of every entity and the job queue.
 *
 * The state comes from the public `get_indexing_status` tool; the queue has no
 * tool, so it is the one private endpoint read on every poll.
 */
async function readIndexState(url, origin, config, force) {
  const now = Date.now();
  const cached = indexCache.get(url);
  if (!force && cached !== undefined && now - cached.at < cached.ttl) return cached.value;

  const remember = (value, ttl) => {
    indexCache.set(url, { at: now, ttl, value });
    return value;
  };

  const previous = isPlainObject(cached?.value) ? cached.value : { entities: new Map(), queue: null };
  try {
    const payload = await mcpInvoke(url, 'get_indexing_status', config, force);
    // The tool answers an envelope (`{ context, total, entities }`), not a bare
    // array, and `context_ref` only ever narrows it.
    const rows = isPlainObject(payload) && Array.isArray(payload.entities)
      ? payload.entities
      : (Array.isArray(payload) ? payload : []);
    const entities = new Map();
    for (const row of rows) {
      if (!isPlainObject(row) || typeof row.id !== 'number') continue;
      entities.set(row.id, projectIndexing(row));
    }
    let queue = previous.queue ?? null;
    if (origin !== null) {
      try {
        queue = projectQueue(await restJson(origin + '/api/system/job-queue', config.contextsTimeoutMs));
      } catch {
        // The queue is decoration: a missing one must not hide the state.
      }
    }
    return remember({ ok: true, error: null, fetchedAt: new Date().toISOString(), entities, queue }, config.indexTtlMs);
  } catch (error) {
    return remember({
      ok: false,
      error: String(error?.message ?? error).slice(0, 200),
      fetchedAt: new Date().toISOString(),
      entities: previous.entities instanceof Map ? previous.entities : new Map(),
      queue: previous.queue ?? null
    }, FAILURE_TTL_MS);
  }
}

/**
 * Read the entity cards of the server: the product name, version and tags a
 * context carries, plus the source a refresh needs.
 *
 * A context being indexed, queued or failed leaves the ready set that
 * `list_contexts` reports, and `get_indexing_status` names it without its
 * product fields. This card fills that gap, and is read only when such a context
 * exists or a refresh is requested.
 */
async function readEntityCards(origin, config, force) {
  if (origin === null) return new Map();
  const now = Date.now();
  const cacheKey = origin + ' cards';
  const cached = indexCache.get(cacheKey);
  if (!force && cached !== undefined && now - cached.at < cached.ttl) return cached.value;

  const previous = isPlainObject(cached?.value) ? cached.value : new Map();
  try {
    const rows = await restJson(origin + '/api/entities', config.contextsTimeoutMs);
    const cards = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isPlainObject(row) || typeof row.id !== 'number') continue;
      cards.set(row.id, {
        id: row.id,
        name: typeof row.name === 'string' ? row.name : '',
        synonym: typeof row.synonym === 'string' ? row.synonym : '',
        version: typeof row.version === 'string' ? row.version : '',
        objectCount: typeof row.object_count === 'number' ? row.object_count : null,
        methodCount: typeof row.bsl_method_count === 'number' ? row.bsl_method_count : null,
        tagIds: Array.isArray(row.tag_ids) ? row.tag_ids.filter((id) => typeof id === 'number') : [],
        sourceLocation: typeof row.source_location === 'string' ? row.source_location : '',
        sourcePath: typeof row.source_path === 'string' ? row.source_path : '',
        sourceMode: typeof row.source_mode === 'string' ? row.source_mode : ''
      });
    }
    indexCache.set(cacheKey, { at: now, ttl: config.indexTtlMs, value: cards });
    return cards;
  } catch {
    return previous;
  }
}

/**
 * Read the full tag catalogue of the server.
 *
 * `list_context_groups` names only tags that label a ready context, so a tag with
 * no context of its own (`z`, `vs`, `q`) has no colour there. The session list also
 * matches a working directory by tag, so the whole catalogue — with its colours —
 * is read from the REST surface and merged into the MCP answer.
 */
async function readTagCatalogue(origin, config, force) {
  if (origin === null) return [];
  const now = Date.now();
  const cacheKey = origin + ' tags';
  const cached = indexCache.get(cacheKey);
  if (!force && cached !== undefined && now - cached.at < cached.ttl) return cached.value;

  const previous = Array.isArray(cached?.value) ? cached.value : [];
  try {
    const rows = await restJson(origin + '/api/tags', config.contextsTimeoutMs);
    // REST rows are `{ id, name, color }`; the MCP group rows are `{ tag, tag_id, color }`.
    const tags = (Array.isArray(rows) ? rows : [])
      .filter((row) => isPlainObject(row) && typeof row.name === 'string' && row.name !== '')
      .map((row) => ({
        id: typeof row.id === 'number' ? row.id : null,
        tag: row.name,
        color: typeof row.color === 'string' ? row.color : ''
      }));
    indexCache.set(cacheKey, { at: now, ttl: config.indexTtlMs, value: tags });
    return tags;
  } catch {
    return previous;
  }
}

/** Read everything the panel shows: the catalogue plus the indexing state. */
async function buildCatalogue(config, options) {
  const url = config.url;
  const origin = restOrigin(url);
  const catalogue = await readMcpCatalogue(url, config, options.refresh);
  const index = await readIndexState(url, origin, config, options.refresh);

  // The tag list of `list_context_groups` covers only used tags; the REST one adds
  // the rest with their colours, so the client can label a folder by tag.
  const restTags = await readTagCatalogue(origin, config, options.refresh);
  const tagsByName = new Map(catalogue.tags.map((tag) => [tag.tag, { ...tag }]));
  for (const tag of restTags) {
    const known = tagsByName.get(tag.tag);
    if (known === undefined) tagsByName.set(tag.tag, { id: tag.id, tag: tag.tag, color: tag.color });
    else if (typeof known.color !== 'string' || known.color === '') known.color = tag.color;
  }
  const tags = [...tagsByName.values()];

  const contexts = catalogue.contexts.map((context) => ({
    ...context,
    indexing: context.id === null ? null : index.entities.get(context.id) ?? null,
    title: contextTitle(context.synonym, context.version, config.abbreviations)
  }));

  // A context the server is working on, or failed on, is absent from the
  // catalogue. The indexing tool still names it; the entity card adds the product
  // and its tags when it is reachable.
  const known = new Set(contexts.map((context) => context.id));
  const rebuilt = new Map();
  const missing = [];
  for (const entity of index.entities.values()) {
    if (entity.id === null || known.has(entity.id)) continue;
    if (entity.status === '' || entity.status === 'ready') continue;
    missing.push(entity);
  }
  if (missing.length > 0) {
    const cards = await readEntityCards(origin, config, options.refresh);
    const tagsById = new Map(catalogue.tags.filter((tag) => tag.id !== null).map((tag) => [tag.id, tag.tag]));
    for (const entity of missing) {
      const card = cards.get(entity.id) ?? null;
      const synonym = card === null ? '' : card.synonym;
      const version = card === null ? '' : card.version;
      rebuilt.set(entity.id, {
        id: entity.id,
        name: card !== null && card.name !== '' ? card.name : entity.name,
        synonym,
        version,
        objectCount: card === null ? entity.objectCount : card.objectCount,
        methodCount: card === null ? entity.methodCount : card.methodCount,
        tags: card === null ? [] : card.tagIds.map((id) => tagsById.get(id)).filter((tag) => tag !== undefined),
        title: contextTitle(synonym, version, config.abbreviations),
        indexing: entity
      });
    }
  }

  // Anything the server is indexing, or has queued to index, leads the list in
  // queue order: the running one, then those waiting, then the paused ones. A
  // queued context can still be reported as ready, so it is taken from either
  // source exactly once. Everything else follows in the server's own order.
  const queue = index.queue;
  const queueOrder = [];
  for (const item of [queue?.running, ...(queue?.pending ?? []), ...(queue?.paused ?? [])]) {
    if (item === null || item === undefined || item.entityId === null) continue;
    if (queueOrder.includes(item.entityId)) continue;
    queueOrder.push(item.entityId);
  }

  const byId = new Map(contexts.map((context) => [context.id, context]));
  const head = [];
  const taken = new Set();
  for (const id of queueOrder) {
    const entry = rebuilt.get(id) ?? byId.get(id);
    if (entry === undefined || taken.has(id)) continue;
    taken.add(id);
    head.push(entry);
  }
  const others = [];
  for (const entry of rebuilt.values()) if (!taken.has(entry.id)) others.push(entry);
  const rest = contexts.filter((context) => !taken.has(context.id));

  return {
    ...catalogue,
    tags,
    contexts: [...head, ...others, ...rest],
    queue,
    indexedAt: index.fetchedAt,
    indexError: index.error
  };
}

/** Answer with a JSON response. */
function json(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

/**
 * Refresh one existing context from its own source path.
 *
 * This is the server's own catalogue action: `import-path` with an `entity_id`
 * re-reads the source, re-parses it and applies only what changed. It is not the
 * full re-embed the server UI calls "Пересобрать индекс".
 */
async function runAction(config, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'the request body must be JSON' }, 400);
  }
  const action = isPlainObject(body) && typeof body.action === 'string' ? body.action : '';
  if (action !== 'import') return json({ ok: false, error: `unsupported action "${action}"` }, 400);
  const entityId = isPlainObject(body) && Number.isInteger(body.entityId) ? body.entityId : null;
  if (entityId === null || entityId <= 0) return json({ ok: false, error: 'entityId must be a positive integer' }, 400);

  const origin = restOrigin(config.url);
  if (origin === null) return json({ ok: false, error: 'the configured url has no usable origin' }, 400);

  try {
    const cards = await readEntityCards(origin, config, false);
    const card = cards.get(entityId) ?? null;
    if (card === null) return json({ ok: false, entityId, action, error: `entity ${entityId} is not known to the server` }, 404);
    if (card.sourceLocation !== 'path' || card.sourcePath === '') {
      return json({ ok: false, entityId, action, error: `entity "${card.name}" has no server-visible source path to refresh from` }, 400);
    }

    const response = await fetch(origin + '/api/entities/import-path', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ source_path: card.sourcePath, source_mode: card.sourceMode, entity_id: entityId }),
      signal: AbortSignal.timeout(config.importTimeoutMs)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = isPlainObject(payload) && typeof payload.detail === 'string' ? payload.detail : 'HTTP ' + response.status;
      return json({ ok: false, entityId, action, error: detail.slice(0, 400) }, 502);
    }
    // Whatever the refresh wrote must show on the next read.
    indexCache.delete(config.url);
    indexCache.delete(origin + ' cards');
    return json({ ok: true, entityId, action, source: card.sourcePath, result: payload }, 200);
  } catch (error) {
    const timedOut = error !== null && typeof error === 'object' && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return json({
      ok: false,
      entityId,
      action,
      error: timedOut
        ? `the refresh did not answer within ${Math.round(config.importTimeoutMs / 1000)}s; the server may still be working — watch the context state`
        : String(error?.message ?? error).slice(0, 300)
    }, timedOut ? 504 : 502);
  }
}

/**
 * Register both routes.
 * @param ctx - Host context carrying the Connection service.
 * @param config - the row's raw configuration.
 */
function apply(ctx, config) {
  const resolved = readConfig(config);
  const connection = ctx.connection;
  if (connection === undefined || connection === null) return;

  connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const query = new URL(request.url).searchParams;
      const catalogue = await buildCatalogue(resolved, { refresh: query.get('refresh') === '1' });
      const origin = restOrigin(resolved.url);
      return json({ pollMs: resolved.pollMs, uiUrl: origin === null ? '' : origin + '/', ...catalogue }, 200);
    }
  });

  connection.fetch.register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => runAction(resolved, request)
  });
}
  apply(ctx, config);
}

/**
 * Temporary diagnostics: the browser half reports what it managed to register, so a
 * silent client-side refusal can be read from a file instead of guessed at.
 * Delete together with the client-side reporter once the panel is green.
 */
// A Fetch route must start with `/api/`: Connection rejects anything else, which
// is why this one never registered and the report never reached the file.
const DIAG_PATH = '/api/dsh-pult/diag';
const DIAG_FILE = join(tmpdir(), 'dsh-pult-activation.log');

/**
 * sessions-export — Host half.
 *
 * Two authenticated exact Fetch routes for the export of the session list:
 *
 *   GET  /api/sessions-activity   what each Session did inside a period
 *   POST /api/sessions-export     write the requested file into ~/Downloads
 *
 * The activity is read from the Session store on disk (`~/.dsh/sessions`): every
 * Session is a directory with an append-only JSONL log, compressed as a chain of
 * zstd frames. A frame chain is not something `zlib` decompresses, so the file is
 * decoded by the `zstd` CLI when one is installed; without it the route says so
 * instead of returning wrong numbers.
 *
 * A Session's work is its turns: `turn/start` … `turn/end` carry the time of both
 * ends. The period clamps each turn, and the sum of the clamped turns is the
 * active time — the time the agent was actually working, not the time the Session
 * sat open. A finished Session is dated by its first and last turn, so a marker
 * written days later (the closing seed) never stretches its end.
 */
/** A plain object, not an array and not null. */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeExportHalf(ctx, config) {
  const row = config !== null && typeof config === 'object' ? config : {};
  const sessionsRoot = typeof row.sessionsRoot === 'string' && row.sessionsRoot !== ''
    ? row.sessionsRoot
    : join(homedir(), '.dsh', 'sessions');
  const exportDir = typeof row.exportDir === 'string' && row.exportDir !== ''
    ? row.exportDir
    : join(homedir(), 'Downloads');
  // A workbook is meant to be looked at: opening it right after writing saves the
  // trip to Finder. Tests switch it off.
  const openExport = row.openExport !== false;
  const connection = ctx.connection;
  if (connection === undefined || connection === null) return;

  connection.fetch.register({
    path: '/api/sessions-activity',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const query = new URL(request.url).searchParams;
      const from = dayStart(query.get('from'));
      const to = dayStart(query.get('to'));
      if (from === null || to === null) return json({ ok: false, error: 'from and to must be YYYY-MM-DD' }, 200);
      if (to < from) return json({ ok: false, error: 'to is before from' }, 200);
      try {
        const sessions = await collectActivity(sessionsRoot, from, to + 86400000);
        return json({ ok: true, from, to, sessions }, 200);
      } catch (error) {
        return json({ ok: false, error: String(error?.message ?? error).slice(0, 300) }, 200);
      }
    },
  });

  connection.fetch.register({
    path: '/api/sessions-export',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json();
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        const format = body?.format === 'xlsx' ? 'xlsx' : 'json';
        const period = isPlainObject(body?.period) ? body.period : {};
        const file = await writeExport(exportDir, format, rows, period);
        const opened = format === 'xlsx' && openExport ? await openFile(file) : false;
        return json({ ok: true, path: file, opened }, 200);
      } catch (error) {
        return json({ ok: false, error: String(error?.message ?? error).slice(0, 300) }, 200);
      }
    },
  });
}

/**
 * Open a written file in its application. macOS and the BSD/Linux desktops have a
 * one-word opener; Windows does not, and is left to the user.
 * @param file - absolute path of the written file.
 * @returns whether the opener was started.
 */
function openFile(file) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (command === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      execFile(command, [file], (error) => resolve(error === null || error === undefined));
    } catch {
      resolve(false);
    }
  });
}

/** A `YYYY-MM-DD` date as local midnight, or null when it does not parse. */
function dayStart(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const at = new Date(year, month - 1, day);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** The zstd binary: the two Homebrew homes, then whatever `PATH` carries. */
function zstdBinary() {
  for (const candidate of ['/opt/homebrew/bin/zstd', '/usr/local/bin/zstd']) {
    if (existsSync(candidate)) return candidate;
  }
  return 'zstd';
}

/** Decompress one Session log — a chain of frames the CLI decodes whole. */
function readSessionLog(file) {
  return new Promise((resolve, reject) => {
    execFile(zstdBinary(), ['-dc', file], { maxBuffer: 512 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
      if (error !== null && error !== undefined) reject(new Error(String(error.message ?? error)));
      else resolve(stdout);
    });
  });
}

/**
 * Read one Session: its title, and its turns.
 * @param text - the decompressed JSONL log.
 * @returns `{ title, cwd, turns }` with turns as `[startMs, endMs]` pairs.
 */
function parseSessionLog(text) {
  const turns = [];
  const open = new Map();
  let title = '';
  let cwd = '';
  let lastAt = 0;
  for (const line of String(text).split('\n')) {
    if (line === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type === 'session') {
      if (typeof record.cwd === 'string') cwd = record.cwd;
      continue;
    }
    if (record?.type === 'session/title' && typeof record?.data?.title === 'string' && record.data.title !== '') {
      title = record.data.title;
    }
    const at = typeof record?.time === 'number' ? record.time : null;
    if (at === null) continue;
    if (at > lastAt) lastAt = at;
    if (record.type === 'turn/start') {
      open.set(record?.data?.turn ?? 0, at);
    } else if (record.type === 'turn/end') {
      const key = record?.data?.turn ?? 0;
      const start = open.get(key);
      if (start !== undefined) {
        turns.push([start, at]);
        open.delete(key);
      }
    }
  }
  // A turn without its end (interrupted, crashed) is closed by the last event.
  for (const start of open.values()) if (lastAt > start) turns.push([start, lastAt]);
  turns.sort((left, right) => left[0] - right[0]);
  return { title, cwd, turns };
}

/**
 * Every Session with work inside the window.
 * @param root - the Session store root.
 * @param from - window start (inclusive).
 * @param to - window end (exclusive).
 */
async function collectActivity(root, from, to) {
  // The store is two levels deep: `<cwd bucket>/<session directory>/<log>`.
  const buckets = await readdir(root, { withFileTypes: true });
  const out = [];
  let failed = 0;
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    let sessions;
    try {
      sessions = await readdir(join(root, bucket.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      let files;
      try {
        files = await readdir(join(root, bucket.name, session.name), { withFileTypes: true });
      } catch {
        continue;
      }
      const log = files.find((entry) => entry.isFile() && entry.name === 'session.v4.jsonl.zstd')
        ?? files.find((entry) => entry.isFile() && entry.name === 'session.jsonl.zstd');
      if (log === undefined) continue;
      const file = join(root, bucket.name, session.name, log.name);
      // The mtime is the last write: a Session untouched since the window cannot
      // have a turn inside it, so the expensive decode is skipped entirely.
      try {
        const info = await stat(file);
        if (info.mtimeMs < from) continue;
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = parseSessionLog(await readSessionLog(file));
      } catch {
        failed += 1;
        continue;
      }
      let start = Infinity;
      let end = 0;
      let activeMs = 0;
      let counted = 0;
      for (const [turnStart, turnEnd] of parsed.turns) {
        const fromClamped = Math.max(turnStart, from);
        const toClamped = Math.min(turnEnd, to);
        if (toClamped <= fromClamped) continue;
        counted += 1;
        activeMs += toClamped - fromClamped;
        if (fromClamped < start) start = fromClamped;
        if (toClamped > end) end = toClamped;
      }
      if (counted === 0) continue;
      out.push({
        id: session.name.replace(/^session-/, ''),
        title: parsed.title,
        cwd: parsed.cwd,
        start,
        end,
        activeMs,
        turns: counted,
      });
    }
  }
  out.sort((left, right) => left.start - right.start);
  if (out.length === 0 && failed > 0) {
    throw new Error(`не удалось прочитать журналы сессий (${failed}) — нужен zstd: brew install zstd`);
  }
  return out;
}

/** `YYYY-MM-DD HH:MM` in local time. */
function localStamp(ms) {
  const at = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** `3 ч 15 мин` for the files, from a millisecond count. */
function durationText(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(total / 60)} ч ${String(total % 60).padStart(2, '0')} мин`;
}

/** One exported row as the files show it. */
function exportRow(row) {
  const cfsmcp2 = Array.isArray(row?.cfsmcp2) ? row.cfsmcp2.filter((tag) => typeof tag === 'string') : [];
  const tags = Array.isArray(row?.tags) ? row.tags.filter((tag) => typeof tag === 'string') : [];
  return {
    session: typeof row?.session === 'string' ? row.session : '',
    cfsmcp2: cfsmcp2.slice(0, 3),
    tags,
    start: Number(row?.start) || 0,
    end: Number(row?.end) || 0,
    activeMs: Number(row?.activeMs) || 0,
  };
}

/** Write the export into the downloads folder and answer with its path. */
async function writeExport(dir, format, rawRows, period) {
  const rows = rawRows.map(exportRow);
  const from = typeof period?.from === 'string' ? period.from : '';
  const to = typeof period?.to === 'string' ? period.to : '';
  const stamp = from === '' ? 'sessions' : `sessions-${from}${to === '' || to === from ? '' : '_' + to}`;
  await mkdir(dir, { recursive: true });
  if (format === 'json') {
    const file = join(dir, `${stamp}.json`);
    const totalMs = rows.reduce((sum, row) => sum + row.activeMs, 0);
    const payload = {
      period: { from, to },
      generatedAt: new Date().toISOString(),
      total: { activeMs: totalMs, active: durationText(totalMs) },
      sessions: rows.map((row) => ({
        session: row.session,
        cfsmcp2_tag_1: row.cfsmcp2[0] ?? '',
        cfsmcp2_tag_2: row.cfsmcp2[1] ?? '',
        cfsmcp2_tag_3: row.cfsmcp2[2] ?? '',
        session_tags: row.tags,
        started_at: row.start === 0 ? '' : localStamp(row.start),
        ended_at: row.end === 0 ? '' : localStamp(row.end),
        active: durationText(row.activeMs),
        active_hours: Math.round((row.activeMs / 3600000) * 100) / 100,
      })),
    };
    await writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  }
  const file = join(dir, `${stamp}.xlsx`);
  await writeFile(file, buildWorkbook(rows, period));
  return file;
}

/** The sheet columns, in order. */
const EXPORT_COLUMNS = [
  { key: 'session', title: 'Наименование сессии', width: 46 },
  { key: 'tag1', title: 'Метка cfsmcp2 1', width: 14 },
  { key: 'tag2', title: 'Метка cfsmcp2 2', width: 14 },
  { key: 'tag3', title: 'Метка cfsmcp2 3', width: 14 },
  { key: 'tags', title: 'Метки сессии', width: 24 },
  { key: 'start', title: 'Начало работы', width: 18 },
  { key: 'end', title: 'Окончание работы', width: 18 },
  { key: 'hours', title: 'Активное время, ч', width: 16 },
];

/**
 * A minimal but valid SpreadsheetML workbook: one sheet, a bold header, one row
 * per Session and a bold total row. The package is a stored (uncompressed) zip —
 * Excel reads it, and nothing here needs a third-party library.
 */
function buildWorkbook(rows, period) {
  const totalMs = rows.reduce((sum, row) => sum + row.activeMs, 0);
  const cell = (ref, value, style) => {
    const styleAttr = style === undefined ? '' : ` s="${style}"`;
    if (typeof value === 'number') return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  };
  const rowXml = (index, values, style) => {
    const cells = values.map((value, column) => cell(`${columnName(column)}${index}`, value, style)).join('');
    return `<row r="${index}">${cells}</row>`;
  };
  const body = rows.map((row, index) => rowXml(index + 2, [
    row.session,
    row.cfsmcp2[0] ?? '',
    row.cfsmcp2[1] ?? '',
    row.cfsmcp2[2] ?? '',
    row.tags.join(', '),
    row.start === 0 ? '' : localStamp(row.start),
    row.end === 0 ? '' : localStamp(row.end),
    Math.round((row.activeMs / 3600000) * 100) / 100,
  ]));
  const span = typeof period?.from === 'string' && typeof period?.to === 'string'
    ? `${period.from} — ${period.to}`
    : '';
  const totalRow = rowXml(rows.length + 2, [
    span === '' ? 'Итого' : `Итого за ${span}`,
    '', '', '', '', '', '',
    Math.round((totalMs / 3600000) * 100) / 100,
  ], 1);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1"/></sheetPr><dimension ref="A1:H${rows.length + 2}"/><cols>${EXPORT_COLUMNS.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols><sheetData>${rowXml(1, EXPORT_COLUMNS.map((column) => column.title), 1)}${body.join('')}${totalRow}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сессии" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}

/** A1, B1, … Z1, AA1 … */
function columnName(index) {
  let name = '';
  let value = index;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

/** XML text escaping, so a Session name or tag never breaks the sheet. */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** CRC-32 of a buffer, for the zip entries. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of stored entries — the container every .xlsx is. */
function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, entry.data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(entry.data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/**
 * lmstudio — Host half.
 *
 * One authenticated exact Fetch route:
 *
 *   GET /api/lmstudio   every model LM Studio knows, with its loaded state
 *
 * The panel runs in the browser, on another origin and another port, so it cannot
 * ask LM Studio itself without CORS from an application that makes no promises
 * about it. The Host is on the same machine, so it asks `api/v0/models` and hands
 * the browser a small, stable shape: the panel never learns LM Studio's REST API
 * version, and a refused connection becomes a row of text instead of a failed
 * cross-origin request.
 *
 * Only the fields the panel draws are mapped, and the mapping never throws: an
 * unexpected answer becomes an empty list rather than a broken section.
 */
/** Answer with a JSON response. */
function json(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function makeModelsHalf(ctx, config) {
  const row = config !== null && typeof config === 'object' ? config : {};
  const base = typeof row.lmStudioUrl === 'string' && row.lmStudioUrl.trim() !== ''
    ? row.lmStudioUrl.trim()
    : 'http://127.0.0.1:1234';
  const timeoutMs = Number.isFinite(row.lmStudioTimeoutMs) && row.lmStudioTimeoutMs > 0 ? row.lmStudioTimeoutMs : 4000;
  const endpoint = `${base.replace(/\/+$/, '')}/api/v0/models`;
  const connection = ctx.connection;
  if (connection === undefined || connection === null) return;

  connection.fetch.register({
    path: '/api/lmstudio',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) return json({ ok: false, url: base, error: `LM Studio ответил HTTP ${response.status}` }, 200);
        const payload = await response.json();
        const models = Array.isArray(payload?.data) ? payload.data.map((model) => ({
          id: typeof model?.id === 'string' ? model.id : '',
          type: typeof model?.type === 'string' ? model.type : 'unknown',
          state: typeof model?.state === 'string' ? model.state : 'unknown',
          publisher: typeof model?.publisher === 'string' ? model.publisher : '',
          quantization: typeof model?.quantization === 'string' ? model.quantization : '',
          maxContext: Number(model?.max_context_length) || 0,
          loadedContext: Number(model?.loaded_context_length) || 0,
        })) : [];
        return json({ ok: true, url: base, models }, 200);
      } catch (error) {
        const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        const code = typeof error?.cause?.code === 'string' ? error.cause.code : '';
        return json({
          ok: false,
          url: base,
          error: timeout
            ? `LM Studio не ответил за ${timeoutMs} мс`
            : code === 'ECONNREFUSED'
            ? `LM Studio не принимает соединение (${base})`
            : code === 'ENOTFOUND'
            ? `адрес LM Studio не найден (${base})`
            : String(error?.cause?.message ?? error?.message ?? error).slice(0, 300),
        }, 200);
      }
    },
  });
}

/** The union of the halves' requirements: they all talk to the Host connection. */
export const inject = ['connection'];

export const name = 'dsh-pult';

/**
 * Register both route families. `config` is the row's configuration, a union of
 * the keys the two halves read.
 */
/** Start every half; a failure in one must not take the others down with it. */
function start(ctx, config) {
  try {
    makeDockerHalf(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.('dsh-pult: the MCP server half failed to start', error);
  }
  try {
    makeCatalogueHalf(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.('dsh-pult: the cfsmcp2 catalogue half failed to start', error);
  }
  try {
    makeModelsHalf(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.('dsh-pult: the LM Studio half failed to start', error);
  }
  try {
    makeExportHalf(ctx, config);
  } catch (error) {
    ctx.logger?.warn?.('dsh-pult: the sessions export half failed to start', error);
  }
}

/**
 * The entry point the loader calls. It never throws: a throwing entry is reported
 * as a bundle that "did not activate", which takes the whole boot down for a
 * failure that is confined to this column.
 */
export function apply(ctx, config) {
  // A marker of this very start: which routes the running Host actually has. The
  // browser half can be newer than the Host (a plugin reload re-reads the bundle
  // but re-runs `apply` from the cached module), and this line tells the two apart.
  try {
    void appendFile(
      DIAG_FILE,
      `${new Date().toISOString()} host start routes=/api/mcp-docker-status,/api/cfsmcp2-contexts,/api/lmstudio,/api/sessions-activity,/api/sessions-export\n`,
      'utf8',
    );
  } catch {
    // A missing log file must not break activation.
  }

  try {
    start(ctx, config);
  } catch (error) {
    try {
      ctx.logger?.warn?.('dsh-pult: activation failed', error);
    } catch {
      // Nothing left to report to.
    }
  }

  // Diagnostics route, registered last and never allowed to fail activation.
  try {
    ctx.connection.fetch.register({
      path: DIAG_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload = null;
        try {
          payload = JSON.parse(String(request.body ?? '{}'));
        } catch {
          payload = { parseError: true };
        }
        const line = `${new Date().toISOString()} ${JSON.stringify(payload)}\n`;
        try {
          await appendFile(DIAG_FILE, line, 'utf8');
        } catch {
          // A missing log file must not break the report.
        }
        try {
          ctx.logger?.info?.('dsh-pult diag', payload);
        } catch {
          // Nothing left to report to.
        }
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
      },
    });
  } catch (error) {
    try {
      ctx.logger?.warn?.('dsh-pult: diagnostics route failed', error);
    } catch {
      // Nothing left to report to.
    }
  }
}

