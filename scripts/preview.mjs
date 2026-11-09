// Render the panel's session list and LM Studio section into one static HTML
// preview. React is stubbed; the component, its styles and its markup are real.
import fs from 'node:fs';

const h = (type, props, ...children) => ({
  type,
  props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
});

let values = [];
let index = 0;
let effectCursor = 0;
const effects = new Map();
const React = {
  createElement: h,
  useState: (initial) => {
    const k = index++;
    if (values[k] === undefined) values[k] = typeof initial === 'function' ? initial() : initial;
    return [values[k], (v) => { values[k] = typeof v === 'function' ? v(values[k]) : v; }];
  },
  useCallback: (fn) => fn,
  useRef: (initial) => {
    const k = index++;
    if (values[k] === undefined || values[k] === null || typeof values[k] !== 'object') values[k] = { current: initial };
    return values[k];
  },
  useEffect: (fn, deps) => {
    const k = effectCursor++;
    const prev = effects.get(k);
    const changed = prev === undefined || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((x, j) => x !== prev.deps[j]);
    if (!changed) return;
    if (prev !== undefined && typeof prev.cleanup === 'function') prev.cleanup();
    effects.set(k, { deps, cleanup: fn() });
  },
  useLayoutEffect: () => {},
};

let definition = null;
globalThis.window = {
  open: () => null,
  // One Session pinned, so the band and its pin render in the preview.
  localStorage: {
    getItem: () => JSON.stringify({
      pins: ['done', 'idleYest'],
      notes: { done: 'Сверить с прошлым кварталом: суммы могли попасть в отчёт дважды' },
      tags: [
        { id: 't1', name: 'Срочно', color: '#ef4444' },
        { id: 't2', name: 'Идея', color: '#3b82f6' },
        { id: 't3', name: 'Дом', color: '#22c55e' },
      ],
      sessionTags: { run: ['t1'], done: ['t2'] },
    }),
    setItem: () => {},
  },
  __ModuleLoader__: { load: (d) => { definition = d; } },
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, url: '', models: [] }) });
(0, eval)(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'));
const mod = definition.factory((name) => {
  if (name === 'react') return React;
  throw new Error(name);
});

const registrations = [];
mod.apply({
  effect: (fn) => { fn(); return () => {}; },
  sidebarRightTabs: { register: () => () => {}, get: () => undefined },
  sidebarRight: { mounted: { getSnapshot: () => undefined }, openTab: () => true },
  slots: { inject: (key, cb) => { cb(); return () => {}; }, register: (owner, component) => { registrations.push({ owner, component }); return () => {}; } },
  uiWorkspace: { openSession: () => {} },
  connection: { fetch: { register: () => () => {} } },
  logger: { info: () => {}, warn: () => {} },
}, {});
const findSeat = (name) => {
  const hit = registrations.find((r) => r.owner.name === name);
  if (hit === undefined) throw new Error(`seat ${name} is not registered`);
  return hit.component;
};

const DAY = 86400000;
const now = Date.now();
const sessions = {
  ids: ['run', 'ask', 'done', 'idleToday', 'idleYest'],
  byId: {
    run: { id: 'run', title: 'Панель: перенос раскладки', cwd: '/Users/alex/work/shop', updatedAt: now - 4000, retainedBy: { mainView: 1 }, projectionValues: { permissions: { currentValue: 'read-only' } } },
    ask: { id: 'ask', title: 'Импорт заказов: вопрос по правилу', cwd: '/Users/alex/work/billing', updatedAt: now - 1 * DAY, projectionValues: { permissions: { currentValue: 'workspace-write' } } },
    done: { id: 'done', title: 'Сверка сумм за квартал', cwd: '/Users/alex/work/crm', updatedAt: now - 2.2 * DAY },
    idleToday: { id: 'idleToday', title: 'Печать: шаблон накладной', cwd: '/Users/alex/work/shop', updatedAt: now - 3 * 3600000 },
    idleYest: { id: 'idleYest', title: 'План и факт: оплаты', cwd: '/Users/alex/work/shop', updatedAt: now - 1.1 * DAY, projectionValues: { permissions: { currentValue: 'danger-full-access' } } },
  },
  phase: 'ready',
};
const statuses = new Map([
  ['run', { running: true }],
  ['ask', { pendingInteraction: { id: 'q1' } }],
  ['done', { completionUnread: true }],
]);

const UNITLESS = new Set(['flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'opacity', 'zIndex', 'order', 'WebkitLineClamp', 'WebkitBoxOrient']);
const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const styleOf = (style) => Object.entries(style ?? {}).map(([key, value]) => {
  if (typeof value === 'number' && !UNITLESS.has(key)) value = `${value}px`;
  const property = key.startsWith('Webkit') ? `-webkit-${key.slice(6).toLowerCase()}` : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `${property}:${value}`;
}).join(';');

function renderNode(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(renderNode).join('');
  if (typeof node !== 'object') return escapeHtml(node);
  const p = node.props ?? {};
  const attrs = [];
  if (p.className) attrs.push(`class="${escapeHtml(p.className)}"`);
  if (p.style) attrs.push(`style="${escapeHtml(styleOf(p.style))}"`);
  // A static preview shows the field's initial text and colour, which React keeps
  // in defaultValue / value.
  if (p.defaultValue !== undefined) attrs.push(`value="${escapeHtml(p.defaultValue)}"`);
  else if (p.value !== undefined) attrs.push(`value="${escapeHtml(p.value)}"`);
  for (const [key, value] of Object.entries(p)) {
    if (['children', 'style', 'className'].includes(key)) continue;
    if (typeof value === 'function' || value === undefined || value === null) continue;
    if (key === 'role' || key === 'title' || key === 'type' || key === 'tabIndex' || key === 'aria-expanded' || key === 'aria-hidden' || key.startsWith('data-')) {
      attrs.push(`${key.toLowerCase()}="${escapeHtml(value)}"`);
    }
  }
  const tag = typeof node.type === 'string' ? node.type : 'div';
  return `<${tag} ${attrs.join(' ')}>${renderNode(p.children)}</${tag}>`;
}

/** Draw a component twice: the first pass starts its effects, the second renders their result. */
async function mount(Component, props) {
  values = [];
  index = 0;
  effectCursor = 0;
  effects.clear();
  Component(props);
  await new Promise((resolve) => setTimeout(resolve, 30));
  index = 0;
  effectCursor = 0;
  return Component(props);
}

const MODELS = [
  { id: 'text-embedding-bge-m3', type: 'embeddings', state: 'loaded', publisher: 'gpustack', quantization: 'F16', maxContext: 8192, loadedContext: 2048 },
  { id: 'qwen3-27b', type: 'vlm', state: 'loaded', publisher: 'lmstudio-community', quantization: 'Q4_K_M', maxContext: 262144, loadedContext: 32768 },
  { id: 'qwen3-4b', type: 'vlm', state: 'not-loaded', publisher: 'lmstudio-community', quantization: 'Q4_K_M', maxContext: 262144, loadedContext: 0 },
  { id: 'text-embedding-nomic-embed-text-v1.5', type: 'embeddings', state: 'not-loaded', publisher: 'nomic-ai', quantization: 'Q8_0', maxContext: 8192, loadedContext: 0 },
];

const rootTokens = {
  dark: {
    '--dsw-alias-bg-base': '#151517', '--dsw-alias-bg-layer-2': '#2c2c2e',
    '--dsw-alias-label-primary': '#f9fafb', '--dsw-alias-label-secondary': '#cfd3d6',
    '--dsw-alias-label-tertiary': '#adb2b8', '--dsw-alias-border-l1': '#ffffff0f',
    '--dsw-alias-border-l2': '#ffffff26', '--dsw-alias-interactive-bg-hover': '#ffffff14',
    '--dsw-alias-interactive-bg-active': '#ffffff24',
    '--dsw-alias-state-business-primary': '#7aaaff', '--dsw-alias-state-business-tertiary': '#34415b',
    '--dsw-alias-state-warn-primary': '#f59e0b', '--dsw-alias-state-warn-tertiary': '#27241f',
    '--dsw-alias-state-success-primary': '#22c55e', '--dsw-alias-state-idle-primary': '#545557',
    '--dsw-alias-state-error-primary': '#fa423e',
    '--dsw-radius-sm': '8px', '--dsw-font-family-code': '"SF Mono", Menlo, monospace',
  },
  light: {
    '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-2': '#ffffff',
    '--dsw-alias-label-primary': '#0f1115', '--dsw-alias-label-secondary': '#cfd3d6',
    '--dsw-alias-label-tertiary': '#adb2b8', '--dsw-alias-border-l1': '#0000000a',
    '--dsw-alias-border-l2': '#0000001f', '--dsw-alias-interactive-bg-hover': '#2631480f',
    '--dsw-alias-interactive-bg-active': '#2631481a',
    '--dsw-alias-state-business-primary': '#4176e6', '--dsw-alias-state-business-tertiary': '#e4edfd',
    '--dsw-alias-state-warn-primary': '#f59e0b', '--dsw-alias-state-warn-tertiary': '#fef5e7',
    '--dsw-alias-state-success-primary': '#22c55e', '--dsw-alias-state-idle-primary': '#d4d4d4',
    '--dsw-alias-state-error-primary': '#e5484d',
    '--dsw-radius-sm': '8px', '--dsw-font-family-code': '"SF Mono", Menlo, monospace',
  },
};

const Sessions = findSeat('mcp-docker-status.bottom');
const Models = findSeat('mcp-docker-status.middle');

const panelContexts = [
  { name: 'shop', tags: ['work', 'shop'] },
  { name: 'billing', tags: ['work', 'billing'] },
  { name: 'crm', tags: ['work', 'crm'] },
];
const panelColours = new Map([
  ['work', '#64748b'], ['shop', '#ec4899'], ['billing', '#22c55e'], ['crm', '#f59e0b'],
]);

const sessionTree = await mount(Sessions, {
  sessionId: 'run',
  contexts: panelContexts,
  tagColours: panelColours,
  useSessions: (select) => select(sessions),
  useSessionStatus: (select) => select(statuses),
});

// The turn finished in the Session on screen: it leaves «На исполнении», the other one stays.
// The pinned Session is running: it moved to «На исполнении», the pin stayed set.
const pinnedRunningTree = await mount(Sessions, {
  sessionId: 'run',
  contexts: [],
  tagColours: new Map(),
  useSessions: (select) => select(sessions),
  useSessionStatus: (select) => select(new Map([
    ['run', { running: true }],
    ['ask', { pendingInteraction: { id: 'q' } }],
    ['done', { running: true }],
  ])),
});

const finishedSessions = {
  ids: ['me', 'other'],
  byId: {
    me: { id: 'me', title: 'Панель: перенос закончен', cwd: '/Users/alex/work/shop', updatedAt: now - 60000, retainedBy: { mainView: 1 } },
    other: { id: 'other', title: 'Сверка сумм за квартал', cwd: '/Users/alex/work/crm', updatedAt: now - 120000 },
  },
  phase: 'ready',
};
const finishedStatuses = new Map([['me', { completionUnread: true }], ['other', { completionUnread: true }]]);
const sessionFinished = await mount(Sessions, {
  sessionId: 'me',
  contexts: [],
  tagColours: new Map(),
  useSessions: (select) => select(finishedSessions),
  useSessionStatus: (select) => select(finishedStatuses),
});

const all = (node) => {
  const out = [];
  const walk = (n) => {
    if (n === null || n === undefined || n === true || n === false) return;
    if (Array.isArray(n)) { for (const c of n) walk(c); return; }
    if (typeof n !== 'object' || n.props === undefined) return;
    out.push(n);
    walk(n.props.children);
  };
  walk(node);
  return out;
};

// The tag manager and the row picker, drawn from the same mounted panel.
const sessionProps = {
  sessionId: 'run',
  contexts: panelContexts,
  tagColours: panelColours,
  useSessions: (select) => select(sessions),
  useSessionStatus: (select) => select(statuses),
};
const redraw = (Component, props) => { index = 0; effectCursor = 0; return Component(props); };
const tagButton = all(sessionTree).find((n) => n.props['data-section'] === 'session-tags');
tagButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
const managerTree = redraw(Sessions, sessionProps);
const doneCluster = all(managerTree)
  .find((n) => String(n.props.className ?? '').includes('cfsp-tag-cluster') && n.props.title === 'Теги: Идея');
doneCluster.props.onClick({ preventDefault() {}, stopPropagation() {} });
const pickerTree = redraw(Sessions, sessionProps);

// Close the picker and the tag manager, open the export panel for its frame.
const pickerCluster = all(pickerTree).find((n) => String(n.props.className ?? '').includes('cfsp-tag-cluster') && n.props.title === 'Теги: Идея');
pickerCluster.props.onClick({ preventDefault() {}, stopPropagation() {} });
const tagButton2 = all(pickerTree).find((n) => n.props['data-section'] === 'session-tags');
tagButton2.props.onClick({ preventDefault() {}, stopPropagation() {} });
const exportButton = all(pickerTree).find((n) => n.props['data-section'] === 'session-export');
exportButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
const exportTree = redraw(Sessions, sessionProps);

const stubModels = (payload, status = 200) => {
  globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
};

stubModels({ ok: true, url: 'http://127.0.0.1:1234', models: MODELS });
const modelsReady = await mount(Models, { visible: true });

stubModels({ ok: true, url: 'http://127.0.0.1:1234', models: MODELS.filter((m) => m.type !== 'embeddings') });
const modelsProblem = await mount(Models, { visible: true });

stubModels({ ok: true, url: 'http://127.0.0.1:1234', models: MODELS.filter((m) => m.state === 'not-loaded') });
const modelsEmpty = await mount(Models, { visible: true });

stubModels({ ok: false, url: 'http://127.0.0.1:1234', error: 'LM Studio не принимает соединение (http://127.0.0.1:1234)' });
const modelsError = await mount(Models, { visible: true });

stubModels({}, 404);
const modelsRoute = await mount(Models, { visible: true });

// Every single-quoted CSS line, at-rules included — the container query matters here.
const css = [...fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8').matchAll(/^\s*'((?:@|\.)[^']*)',\s*$/gm)].map((m) => m[1]).join('\n');

const frame = (theme, caption, body) => `<div class="cell"><div class="caption">${caption}</div><div class="frame ${theme}" style="${styleOf(rootTokens[theme])}">${renderNode(body)}</div></div>`;

const STYLE = `
  body{margin:0;background:#0b0b0c;font-family:-apple-system,"SF Pro Text",Montserrat,system-ui,sans-serif;color:#f9fafb;padding:16px;display:grid;gap:14px 20px}
  .cell{display:flex;flex-direction:column;gap:4px}
  .caption{font:11px/1.6 -apple-system,sans-serif;color:#adb2b8;padding:0 10px}
  .frame{padding:10px 8px;border-radius:12px;display:flex;flex-direction:column}
  .dark{background:#151517}
  .light{background:#f9fafb;color:#0f1115}
  .light .caption{color:#61666b}
  ${css}
`;

/** One static page: the frames laid out in `columns` columns. */
const pageOf = (frames, columns) => `<!doctype html><meta charset="utf-8"><title>dsh-pult preview</title>
<style>
  body{grid-template-columns:repeat(${columns},380px)}
  ${STYLE}
</style>
${frames.join('\n')}
`;

// The sheet: every frame, two to a row.
const sheet = [
  frame('dark', 'Сессии: доступ в цвете заголовка, закреплённые с комментарием', sessionTree),
  frame('light', 'Сессии: светлая тема', sessionTree),
  frame('dark', 'Закреплённая выполняется — ушла в «На исполнении», иголка на месте', pinnedRunningTree),
  frame('dark', 'Теги: настройка в шапке', managerTree),
  frame('dark', 'Теги: выбор в строке сессии', pickerTree),
  frame('dark', 'Экспорт сессий за период', exportTree),
  frame('dark', 'Сессия на экране завершилась — ушла из «На исполнении»', sessionFinished),
  frame('dark', 'LM Studio: эмбеддинг загружен', modelsReady),
  frame('light', 'LM Studio: эмбеддинг загружен — светлая тема', modelsReady),
  frame('dark', 'LM Studio: LLM есть, эмбеддинга нет — проблема', modelsProblem),
  frame('light', 'LM Studio: LLM есть, эмбеддинга нет — светлая тема', modelsProblem),
  frame('dark', 'LM Studio: ничего не загружено', modelsEmpty),
  frame('dark', 'LM Studio: не отвечает', modelsError),
  frame('dark', 'Host не знает маршрут — старый Host', modelsRoute),
];

// The pictures the README shows: two columns each, one theme pair.
const sessionsPair = [
  frame('dark', 'Сессии: закреплённые, «На исполнении», дни', sessionTree),
  frame('light', 'Сессии: светлая тема', sessionTree),
];
const modelsPair = [
  frame('dark', 'LM Studio: эмбеддинг загружен', modelsReady),
  frame('light', 'LM Studio: эмбеддинг загружен — светлая тема', modelsReady),
  frame('dark', 'LM Studio: LLM есть, эмбеддинга нет', modelsProblem),
  frame('light', 'LM Studio: LLM есть, эмбеддинга нет — светлая тема', modelsProblem),
  frame('dark', 'LM Studio: ничего не загружено', modelsEmpty),
  frame('dark', 'LM Studio: не отвечает', modelsError),
  frame('dark', 'Host не знает маршрут — старый Host', modelsRoute),
];

const write = (name, html) => {
  const out = new URL(`../docs/${name}`, import.meta.url);
  fs.writeFileSync(out, html);
  console.log(`written docs/${name}`);
};
write('preview.html', pageOf(sheet, 2));
write('preview-sessions.html', pageOf(sessionsPair, 2));
write('preview-models.html', pageOf(modelsPair, 2));

process.exit(0);
