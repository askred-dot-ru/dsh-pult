/**
 * dsh-pult — Client half.
 *
 * One bundle for the whole MCP column of the right sidebar: the cfsmcp2 catalogue
 * at the top, the models loaded in LM Studio under it, the tracked MCP servers and
 * containers in the middle, the Harness session list at the foot. Three of them
 * used to be three bundles that found each other through declared seats; they share
 * one page, one style language and one memory of what the reader folded.
 *
 * The seats are still declared and still filled — by this same bundle — so the page
 * keeps its shape (a list seat at the top, one between the catalogue and the rows,
 * one at the bottom) while the code lives in one place.
 *
 * Folding state is not per component and not per Session: `uiStore` below keeps it
 * in `localStorage`, so collapsing the catalogue in one Session shows it collapsed
 * in the next one and on the way back.
 *
 * React comes from the browser module table; no Harness Client package is
 * imported. Colours are theme tokens, so both themes read correctly.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pult',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Services the panel reaches at runtime; filled in by `apply`. */
    const bridge = { uiWorkspace: null, sidebarRight: null, sidebarRightTabs: null };

    /**
     * The panel's own settings, shared by its three sections and remembered across
     * Sessions.
     *
     * A reader who folds the catalogue in one Session expects it folded in the next
     * one and still folded on the way back, so the state cannot live in a component:
     * it lives here, in one small store, and is written to `localStorage` on every
     * change. Failures to read or write it are swallowed — a panel without memory is
     * worse than none, but not worth an error over the list.
     */
    const UI_KEY = 'dsh.pult.v1';

    /** @typedef {{ catalogue: boolean, sessions: boolean, models: boolean, groups: string[], buckets: string[], pins: string[], notes: Record<string, string>, tags: Array<{ id: string, name: string, color: string }>, sessionTags: Record<string, string[]> }} PanelUi */

    /** The shipped state: everything open, nothing folded, nothing pinned, no comments, no tags. */
    const UI_DEFAULT = { catalogue: false, sessions: false, models: false, groups: [], buckets: [], pins: [], notes: {}, tags: [], sessionTags: {} };

    function readUi() {
      try {
        const raw = window.localStorage.getItem(UI_KEY);
        if (typeof raw !== 'string' || raw === '') return { ...UI_DEFAULT };
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return { ...UI_DEFAULT };
        return {
          catalogue: parsed.catalogue === true,
          sessions: parsed.sessions === true,
          models: parsed.models === true,
          groups: Array.isArray(parsed.groups) ? parsed.groups.filter((item) => typeof item === 'string') : [],
          buckets: Array.isArray(parsed.buckets) ? parsed.buckets.filter((item) => typeof item === 'string') : [],
          pins: Array.isArray(parsed.pins) ? parsed.pins.filter((item) => typeof item === 'string') : [],
          notes: parsed.notes !== null && typeof parsed.notes === 'object' && !Array.isArray(parsed.notes)
            ? Object.fromEntries(Object.entries(parsed.notes).filter(([, text]) => typeof text === 'string' && text !== ''))
            : {},
          tags: Array.isArray(parsed.tags)
            ? parsed.tags
              .filter((tag) => tag !== null && typeof tag === 'object'
                && typeof tag.id === 'string' && tag.id !== ''
                && typeof tag.name === 'string' && tag.name.trim() !== '')
              .map((tag) => ({
                id: tag.id,
                name: tag.name.trim().slice(0, 40),
                color: /^#[0-9a-f]{6}$/i.test(String(tag.color ?? '')) ? String(tag.color).toLowerCase() : '#64748b',
              }))
            : [],
          sessionTags: parsed.sessionTags !== null && typeof parsed.sessionTags === 'object' && !Array.isArray(parsed.sessionTags)
            ? Object.fromEntries(Object.entries(parsed.sessionTags)
              .filter(([, ids]) => Array.isArray(ids))
              .map(([key, ids]) => [key, ids.filter((id) => typeof id === 'string')]))
            : {},
        };
      } catch {
        return { ...UI_DEFAULT };
      }
    }

    /** The live state, plus the subscribers a hook re-renders. */
    const uiStore = {
      value: readUi(),
      listeners: new Set(),
      set(next) {
        uiStore.value = next;
        try {
          window.localStorage.setItem(UI_KEY, JSON.stringify(next));
        } catch {
          // A full or blocked storage keeps the panel working for this Session.
        }
        for (const listener of uiStore.listeners) listener();
      },
    };

    /** Subscribe a component to the store, re-rendering it on every change. */
    function useUiStore() {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const listener = () => force((value) => value + 1);
        uiStore.listeners.add(listener);
        return () => {
          uiStore.listeners.delete(listener);
        };
      }, []);
      return uiStore.value;
    }

    /** One section's open/closed flag, remembered across Sessions. */
    function usePanelFlag(key) {
      const ui = useUiStore();
      const toggle = React.useCallback((next) => {
        const current = uiStore.value[key] === true;
        const value = typeof next === 'function' ? next(current) : !current;
        uiStore.set({ ...uiStore.value, [key]: value === true });
      }, [key]);
      return [ui[key] === true, toggle];
    }

    /** One list of folded names (server groups, day buckets), remembered across Sessions. */
    function usePanelSet(key) {
      const ui = useUiStore();
      const get = React.useCallback(() => new Set(uiStore.value[key]), [key]);
      const [snapshot, setSnapshot] = React.useState(get);
      React.useEffect(() => {
        const listener = () => setSnapshot(() => new Set(uiStore.value[key]));
        uiStore.listeners.add(listener);
        setSnapshot(() => new Set(uiStore.value[key]));
        return () => {
          uiStore.listeners.delete(listener);
        };
      }, [key]);
      const update = React.useCallback((next) => {
        const current = new Set(uiStore.value[key]);
        const value = typeof next === 'function' ? next(current) : next;
        uiStore.set({ ...uiStore.value, [key]: [...value] });
      }, [key]);
      return [snapshot, update];
    }

    /** The first and the last day of the previous month, as `YYYY-MM-DD`. */
    function previousMonth() {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return { from: iso(first), to: iso(last) };
    }

    /** The colours offered for a new tag, in the order the panel walks them. */
    const TAG_PALETTE = ['#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#a855f7', '#ef4444', '#64748b'];

    /** A stable-enough identity for a tag created in the panel; nothing outside reads it. */
    function newTagId() {
      return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    /**
     * The reader's own session tags: a flat catalogue of name+colour and the
     * assignment of those tags to Sessions. Nothing is imported — cfsmcp2 has its
     * own tags for contexts, and the two systems never meet. Both lists live in the
     * same store as the pins, so a reload keeps them.
     */
    function usePanelTags() {
      const ui = useUiStore();
      const tags = Array.isArray(ui.tags) ? ui.tags : [];
      const assignments = ui.sessionTags !== null && typeof ui.sessionTags === 'object' && !Array.isArray(ui.sessionTags)
        ? ui.sessionTags
        : {};
      const write = (next) => uiStore.set({ ...uiStore.value, ...next });
      const ids = (sessionId) => {
        const list = assignments[String(sessionId)];
        return Array.isArray(list) ? list : [];
      };
      const create = (name, color) => {
        const clean = typeof name === 'string' ? name.trim().slice(0, 40) : '';
        if (clean === '') return;
        const exists = tags.some((tag) => tag.name.toLowerCase() === clean.toLowerCase());
        if (exists) return;
        write({ tags: [...tags, { id: newTagId(), name: clean, color: String(color ?? '#64748b') }] });
      };
      const update = (id, patch) => {
        write({
          tags: tags.map((tag) => (tag.id === id ? {
            ...tag,
            ...(typeof patch.name === 'string' && patch.name.trim() !== '' ? { name: patch.name.trim().slice(0, 40) } : null),
            ...(typeof patch.color === 'string' ? { color: patch.color } : null),
          } : tag)),
        });
      };
      const remove = (id) => {
        const rest = {};
        for (const [session, list] of Object.entries(assignments)) {
          const kept = list.filter((tagId) => tagId !== id);
          if (kept.length > 0) rest[session] = kept;
        }
        write({ tags: tags.filter((tag) => tag.id !== id), sessionTags: rest });
      };
      const toggle = (sessionId, tagId) => {
        const key = String(sessionId);
        const current = ids(key);
        const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
        const all = { ...assignments };
        if (next.length === 0) delete all[key];
        else all[key] = next;
        write({ sessionTags: all });
      };
      return { tags, assignments, ids, create, update, remove, toggle };
    }

    /**
     * One short comment per Session, by id. Like the pins it is the reader's note
     * about the list, not a setting of a Session, so it lives in the same store and
     * survives both a reload and a Session switch.
     */
    function usePanelNotes() {
      const ui = useUiStore();
      const notes = ui.notes !== null && typeof ui.notes === 'object' && !Array.isArray(ui.notes) ? ui.notes : {};
      const set = React.useCallback((id, text) => {
        const key = String(id);
        const next = { ...(uiStore.value.notes ?? {}) };
        const value = typeof text === 'string' ? text.trim().slice(0, 300) : '';
        if (value === '') delete next[key];
        else next[key] = value;
        uiStore.set({ ...uiStore.value, notes: next });
      }, []);
      return [notes, set];
    }

    // ── cfsmcp2 catalogue ─────────────────────────────────────────────────────
    const CatalogueSection = (() => {
      let platform = null;
    /** This implementation's identity in the tab system, and the key its body registers under. */
    const TAB_ID = '@local/cfsmcp2-contexts';
    /** The page kind the guide entry opens. */
    const TAB_KIND = 'cfsmcp2-contexts';
    const TAB_TITLE = 'Контексты cfsmcp2';
    const TAB_DESCRIPTION = 'Каталог контекстов cfsmcp2: метки, прогресс индексации и очередь';
    /**
     * A seat another bundle may declare at the top of its own page. Filling it is
     * optional: it lets this panel also sit above @local/mcp-docker-status's
     * container list, and with that bundle absent nothing here changes.
     */
    const SEAT = 'mcp-docker-status.top';
    /** This entry's identity inside that list seat. */
    const ENTRY_ID = '@local/cfsmcp2-contexts';
    /** Document-relative Host routes, so the browser resolves them under its own mount. */
    const ROUTE = 'api/cfsmcp2-contexts';
    const ACTION_ROUTE = 'api/cfsmcp2-contexts/action';
    /** The documented default address, for a host half that reports none. */
    const FALLBACK_UI_URL = 'http://127.0.0.1:8559/';
    const DEFAULT_POLL_MS = 5000;
    /** How long an action result stays in the header. */
    const NOTICE_MS = 120000;

    /** Entity statuses that mean the server is already working on this context. */
    const INDEX_BUSY = new Set(['indexing', 'parsing', 'parse', 'index', 'loading', 'queued']);

    /**
     * Styles. Rendered as an element, so unmounting removes them; the class
     * prefix keeps them out of every other plugin's namespace.
     */
    const CSS = [
      '.cfsc-load:focus-visible,.cfsc-ui:focus-visible,.cfsc-refresh:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.cfsc-load{border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      // «+ Новая сессия»: the one action in the session list, so it reads as a button.
      '.cfsc-load:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.cfsc-load:disabled{opacity:.5;cursor:default}',
      '.cfsc-chip{color:var(--dsw-alias-label-secondary)}',
      '.cfsc-chip:hover{color:var(--dsw-alias-label-primary)}',
      '.cfsc-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.cfsc-ui:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
    ].join('');

    /** Compact duration for an ETA expressed in seconds. */
    function formatEta(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
      const total = Math.round(seconds);
      if (total < 60) return total + 's';
      const minutes = Math.floor(total / 60);
      if (minutes < 60) return minutes + 'm' + String(total % 60).padStart(2, '0');
      return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
    }

    /**
     * The displayed product name: the abbreviation the Host resolved from the
     * synonym, else the server's own synonym.
     *
     * A context's `name` never goes through here — it is the argument a search
     * call must carry, so it is shown exactly as the server reports it.
     */
    function labelFor(context) {
      if (typeof context.title === 'string' && context.title !== '') return context.title;
      return typeof context.synonym === 'string' ? context.synonym : '';
    }

    /** Styles: theme tokens only, so a renamed token degrades but never breaks. */
    const S = {
      box: {
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '6px 6px 6px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: 1.45,
      },
      head: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px' },
      // The title is the section's disclosure control: it names the section and
      // closes everything under the head.
      title: {
        flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0,
        border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 600,
      },
      /** The chevron of that control. */
      titleChevron: { flex: 'none', width: 9, fontSize: 9, color: 'var(--dsw-alias-label-secondary)' },
      counter: { flex: 'auto', minWidth: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      refresh: {
        flex: 'none', width: 22, height: 22, padding: 0, border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', font: 'inherit',
      },
      /** The control that opens the server's own web UI. */
      ui: {
        flex: 'none', height: 22, padding: '0 8px', boxSizing: 'border-box',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer', font: 'inherit', fontSize: 11, lineHeight: '20px',
      },
      search: {
        width: '100%', boxSizing: 'border-box', height: 26, padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        font: 'inherit', fontSize: 12,
      },
      tags: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '0 6px' },
      chip: (active, tone) => ({
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 7px', borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 11,
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        border: '0.5px solid ' + (active ? tone : 'var(--dsw-alias-border-l2)'),
        background: active ? 'color-mix(in srgb, ' + tone + ' 22%, transparent)' : 'transparent',
      }),
      clear: {
        padding: 0, border: 'none', background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', font: 'inherit', fontSize: 11,
        textDecoration: 'underline',
      },
      dot: (tone) => ({
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        background: tone === undefined || tone === null || tone === '' ? 'var(--dsw-alias-label-tertiary)' : tone,
      }),
      queueBox: {
        display: 'flex', flexDirection: 'column', gap: 3, padding: '5px 6px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      queueTitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      queueItems: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      queueChip: {
        padding: '0 5px', borderRadius: 999, fontSize: 10,
        color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-base)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
      },
      queueChipPaused: {
        padding: '0 5px', borderRadius: 999, fontSize: 10,
        color: 'var(--dsw-alias-label-tertiary)', border: '0.5px dashed var(--dsw-alias-border-l2)',
      },
      list: { display: 'flex', flexDirection: 'column', maxHeight: 300, overflowY: 'auto' },
      row: { padding: '6px 6px', borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
      rowTop: { display: 'flex', alignItems: 'baseline', gap: 6 },
      name: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 500, userSelect: 'text' },
      version: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
      spacer: { flex: 'auto', minWidth: 4 },
      synonym: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, overflowWrap: 'anywhere' },
      tagLine: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 },
      pill: {
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '0 5px', borderRadius: 999, fontSize: 10,
        color: 'var(--dsw-alias-label-secondary)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      load: {
        flex: 'none', height: 22, padding: '0 8px', boxSizing: 'border-box',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer', font: 'inherit', fontSize: 11, lineHeight: '20px',
      },
      progress: { flex: 'none', color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11 },
      bar: { height: 3, marginTop: 4, borderRadius: 2, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
      barFill: (pct) => ({
        height: '100%', borderRadius: 2,
        width: String(Math.max(0, Math.min(100, typeof pct === 'number' ? pct : 0))) + '%',
        background: 'var(--dsw-alias-state-warn-primary)',
      }),
      state: (tone) => ({
        color: tone === 'bad' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)',
        fontSize: 11, marginTop: 2, overflowWrap: 'anywhere',
      }),
      note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, padding: '4px 0' },
      notice: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11, overflowWrap: 'anywhere' },
    };

    /** Poll the catalogue while the panel is on screen, restarting on refresh. */
    function useCatalogue(visible) {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null });
      const [generation, setGeneration] = React.useState(0);
      const intervalRef = React.useRef(DEFAULT_POLL_MS);
      // Set by the refresh action: the next read also re-reads the catalogue.
      const refreshOnce = React.useRef(false);

      React.useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        let timer = null;
        const tick = async () => {
          try {
            const parameters = new URLSearchParams();
            if (refreshOnce.current) {
              refreshOnce.current = false;
              parameters.set('refresh', '1');
            }
            const suffix = parameters.toString() === '' ? '' : `?${parameters.toString()}`;
            const response = await fetch(`${ROUTE}${suffix}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (typeof data.pollMs === 'number' && data.pollMs >= 1000) intervalRef.current = data.pollMs;
            if (!cancelled) setState({ phase: 'ready', data, error: null });
          } catch (error) {
            if (!cancelled) {
              setState((previous) => ({
                phase: 'error',
                data: previous.data,
                error: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            if (!cancelled) timer = setTimeout(tick, intervalRef.current);
          }
        };
        tick();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [visible, generation]);

      return {
        state,
        refresh: () => {
          refreshOnce.current = true;
          setGeneration((value) => value + 1);
        },
      };
    }

    /**
     * The whole context browser.
     *
     * It is registered twice: as this bundle's own sidebar page, and as the
     * occupant of the optional seat when another bundle declares one. As a page
     * it fills the column and reads its visibility from its own tab; as a seat
     * block it is handed `visible` by the page it sits in.
     */
    function ContextsPanel(props) {
      const standalone = props.standalone === true;
      const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
      const visible = tabInfo !== undefined && tabInfo.tab !== undefined
        ? tabInfo.tab.visible !== false
        : props.visible !== false;
      const { state, refresh } = useCatalogue(visible);

      // Whether the section is closed: the head stays, everything under it goes.
      const [collapsed, setCollapsed] = usePanelFlag('catalogue');
      const armTimer = React.useRef(null);
      const laterTimer = React.useRef(null);
      const alive = React.useRef(true);
      const [query, setQuery] = React.useState('');
      const [activeTags, setActiveTags] = React.useState([]);
      const [reloading, setReloading] = React.useState(null);
      const [notice, setNotice] = React.useState(null);

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
          if (armTimer.current !== null) clearTimeout(armTimer.current);
          if (laterTimer.current !== null) clearTimeout(laterTimer.current);
        };
      }, []);

      React.useEffect(() => {
        if (notice === null) return undefined;
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
      }, [notice]);

      const data = state.data;
      const contexts = data !== null && data !== undefined && Array.isArray(data.contexts) ? data.contexts : [];
      const tags = data !== null && data !== undefined && Array.isArray(data.tags) ? data.tags : [];
      const queue = data !== null && data !== undefined && data.queue !== undefined ? data.queue : null;
      const failed = data !== null && data !== undefined && data.ok === false;
      // The host names the server's own web UI. A host half older than this
      // control does not report it, so the documented default stands in.
      const uiUrl = data !== null && data !== undefined && typeof data.uiUrl === 'string' && data.uiUrl !== ''
        ? data.uiUrl
        : FALLBACK_UI_URL;
      const colours = new Map(tags.map((entry) => [entry.tag, entry.color]));

      const needle = query.trim().toLowerCase();
      const shown = contexts.filter((context) => {
        if (activeTags.length > 0 && !context.tags.some((tag) => activeTags.includes(tag))) return false;
        if (needle === '') return true;
        if (context.name.toLowerCase().includes(needle)) return true;
        // Both the displayed abbreviation and the full product name answer a search.
        if (labelFor(context).toLowerCase().includes(needle)) return true;
        if (context.synonym !== '' && context.synonym.toLowerCase().includes(needle)) return true;
        return context.tags.some((tag) => tag.toLowerCase().includes(needle));
      });

      /** Ask the server to refresh one context from its own source path. */
      const performReload = async (context) => {
        setReloading(context.name);
        setNotice(null);
        try {
          const response = await fetch(ACTION_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'import', entityId: context.id }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload === null || payload.ok !== true) {
            throw new Error(payload !== null && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
          }
          const result = payload.result !== undefined && payload.result !== null ? payload.result : null;
          const status = result !== null && typeof result.status === 'string' ? result.status : 'started';
          if (alive.current) setNotice(`${context.name}: ${status}`);
        } catch (error) {
          if (alive.current) setNotice(`${context.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (alive.current) {
            setReloading(null);
            refresh();
            if (laterTimer.current !== null) clearTimeout(laterTimer.current);
            laterTimer.current = setTimeout(() => { if (alive.current) refresh(); }, 2500);
          }
        }
      };

      /**
       * Open the server's own web UI in a new tab.
       *
       * This is the harness's own way of leaving the app — the chat and browser
       * plugins open an external address with exactly this call, and the desktop
       * shell hands an `http`/`https` popup to the system browser. So the click
       * needs no help from the host, which also means it works while the host
       * half is still an older module.
       */
      const openUi = () => {
        window.open(uiUrl, '_blank', 'noopener,noreferrer');
      };

      const queueName = (item) => (item.name !== '' ? item.name : (item.entityId === null ? '?' : '#' + item.entityId));
      const queueItems = [];
      let queueLine = null;
      if (queue !== null && queue !== undefined && queue.totalCount > 0) {
        queueLine = 'Очередь ' + queue.totalCount +
          (queue.running !== null ? ' · идёт ' + queueName(queue.running) : '') +
          (queue.pendingCount > 0 ? ' · ждут ' + queue.pendingCount : '') +
          (queue.pausedCount > 0 ? ' · пауза ' + queue.pausedCount : '');
        for (const item of queue.pending) queueItems.push(h('span', { key: 'qp' + queueItems.length, style: S.queueChip }, queueName(item)));
        for (const item of queue.paused) queueItems.push(h('span', { key: 'qs' + queueItems.length, style: S.queueChipPaused }, queueName(item)));
      }

      /** Close everything under the head, leaving the head itself in place. */
      const collapse = () => setCollapsed((previous) => !previous);

      const chip = (entry) => {
        const active = activeTags.includes(entry.tag);
        const tone = typeof entry.color === 'string' && entry.color !== '' ? entry.color : 'var(--dsw-alias-label-tertiary)';
        return h('button', {
          key: `filter:${entry.tag}`,
          type: 'button',
          className: 'cfsc-chip',
          style: S.chip(active, tone),
          title: (entry.count === null ? '' : entry.count + ' context(s) · ') + (active ? 'filtering by ' : 'filter by ') + 'tag:' + entry.tag,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setActiveTags(active ? activeTags.filter((tag) => tag !== entry.tag) : [...activeTags, entry.tag]);
          },
        }, h('span', { style: S.dot(tone) }), h('span', null, entry.tag));
      };

      return h('div', {
        style: standalone ? { ...S.box, height: '100%', boxSizing: 'border-box', borderBottom: 'none' } : S.box,
      },
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { style: S.head },
          h('button', {
            type: 'button',
            style: S.title,
            'data-section': 'contexts',
            'aria-expanded': collapsed ? 'false' : 'true',
            title: collapsed ? 'Развернуть «cfsmcp2 contexts»' : 'Свернуть «cfsmcp2 contexts»',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              collapse();
            },
          }, [
            h('span', { key: 'chevron', style: S.titleChevron, 'aria-hidden': true }, collapsed ? '▸' : '▾'),
            h('span', { key: 'label' }, 'cfsmcp2 contexts'),
          ]),
          h('span', { style: S.counter }, contexts.length === 0
            ? (failed ? 'unavailable' : (state.phase === 'error' ? 'unreachable' : 'loading…'))
            : shown.length + '/' + contexts.length),
          h('button', {
            type: 'button', className: 'cfsc-refresh', style: S.refresh,
            title: 'Refresh now', 'aria-label': 'Refresh contexts', onClick: () => refresh(),
          }, '⟳'),
          h('button', {
            type: 'button',
            className: 'cfsc-ui',
            style: S.ui,
            title: `Открыть веб-интерфейс cfsmcp2 — ${uiUrl}`,
            'aria-label': 'Открыть веб-интерфейс cfsmcp2',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              openUi();
            },
          }, 'UI'),
        ),
        // Everything the head governs, in one place, so closing the section is one
        // branch instead of a flag on every element.
        collapsed ? null : [
        notice === null ? null : h('div', { key: 'notice', style: S.notice }, notice),
        failed ? h('div', { key: 'error', style: S.notice }, data.error) : null,
        h('input', {
          key: 'search',
          type: 'search',
          value: query,
          placeholder: 'Filter contexts by name or tag',
          'aria-label': 'Filter contexts',
          style: S.search,
          onChange: (event) => setQuery(event.target.value),
        }),
        tags.length === 0 ? null : h('div', { key: 'tags', style: S.tags },
          tags.map(chip),
          activeTags.length === 0 ? null : h('button', {
            type: 'button', style: S.clear,
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); setActiveTags([]); },
          }, 'clear'),
        ),
        queueLine === null ? null : h('div', { key: 'queue', style: S.queueBox },
          h('div', { style: S.queueTitle }, queueLine),
          queueItems.length === 0 ? null : h('div', { style: S.queueItems }, queueItems),
        ),
        h('div', { key: 'list', style: standalone ? { ...S.list, maxHeight: 'none', flex: 'auto', minHeight: 0 } : S.list }, shown.length === 0
          ? h('div', { style: S.note }, contexts.length === 0 ? 'The context catalogue is not available yet.' : 'Nothing matches the filter.')
          : shown.map((context) => {
            const indexing = context.indexing === undefined ? null : context.indexing;
            const status = indexing === null ? '' : indexing.status;
            const indexingNow = INDEX_BUSY.has(status);
            const broken = indexing !== null && indexing.errorMessage !== '';
            const stateLine = indexing === null
              ? null
              : broken
                ? indexing.errorMessage
                : indexingNow
                  ? (indexing.progressText !== '' ? indexing.progressText : 'индексация')
                  : status !== '' && status !== 'ready'
                    ? status + (indexing.parseDelta === '' ? '' : ' · ' + indexing.parseDelta)
                    : null;
            const eta = indexing === null ? '' : formatEta(indexing.etaSec);
            return h('div', { key: context.name, 'data-context': context.name, style: S.row },
              h('div', { style: S.rowTop },
                h('span', { style: S.name }, context.name),
                context.version === '' ? null : h('span', { style: S.version }, context.version),
                h('span', { style: S.spacer }),
                indexingNow
                  ? h('span', { style: S.progress }, (indexing.progressPct ?? 0) + '%' + (eta === '' ? '' : ' · ' + eta))
                  : h('button', {
                      type: 'button',
                      className: 'cfsc-load',
                      style: S.load,
                      disabled: reloading !== null,
                      title: 'Загрузить — перечитать источник «' + context.name + '» и применить только изменения',
                      onClick: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void performReload(context);
                      },
                    }, reloading === context.name ? '…' : 'Загрузить'),
              ),
              labelFor(context) === '' ? null : h('div', { style: S.synonym, title: context.synonym }, labelFor(context)),
              h('div', { style: S.tagLine }, context.tags.map((tag) => h('span', { key: tag, style: S.pill },
                h('span', { style: S.dot(colours.get(tag)) }),
                h('span', null, tag),
              ))),
              indexingNow ? h('div', { style: S.bar }, h('div', { style: S.barFill(indexing.progressPct) })) : null,
              stateLine === null ? null : h('div', { style: S.state(broken ? 'bad' : 'warn') }, stateLine),
            );
          })),
        ],
      );
    }

      return { component: ContextsPanel };
    })();

    // ── Harness session list ──────────────────────────────────────────────────
    const SessionsSection = (() => {
      let platform = bridge;
    /** Set by apply, so a session click can reach the workspace service. */
    /** The seat under the MCP-server rows, declared by @local/mcp-docker-status. */
    const SEAT = 'mcp-docker-status.bottom';
    /** This bundle's identity inside that list seat. */
    const ENTRY_ID = '@local/sessions-panel';
    /** The cfsmcp2 catalogue route, document-relative so the browser resolves it. */
    const ROUTE = 'api/cfsmcp2-contexts';

    /**
     * Styles. Rendered as an element, so unmounting removes them; the class prefix
     * keeps them out of every other bundle's namespace.
     */
    const CSS = [
      '.cfsp-session:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cfsp-session:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.cfsp-new{border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.cfsp-new:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.cfsp-new:active{transform:translateY(0.5px)}',
      '.cfsp-new:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '@keyframes cfsp-spin{to{transform:rotate(360deg)}}',
      '@keyframes cfsp-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.84);opacity:.6}}',
      '@keyframes cfsp-glow{0%,100%{box-shadow:0 0 4px currentColor}50%{box-shadow:0 0 10px 1px currentColor}}',
      // A live session: a bright half ring turning fast, haloed in its own colour.
      '.cfsp-run{display:inline-flex;border-radius:50%;border:2px solid transparent;border-top-color:currentColor;border-right-color:currentColor;box-sizing:border-box;animation:cfsp-spin .7s linear infinite,cfsp-glow 1.4s ease-in-out infinite}',
      // The live row itself is washed with the same colour, so the eye finds it
      // before it reads a single word. Hover still wins: it is the later, heavier rule.
      '.cfsp-live{background-image:linear-gradient(color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent),color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent))}',
      // The Session on screen: a contour around the whole row. It is drawn as an inset
      // shadow rather than a border, so it follows the row's radius, never changes the
      // row's size and leaves the live row's own wash underneath untouched.
      '.cfsp-here{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}',
      // A question waiting for the reader: an outlined «?» that breathes.
      '.cfsp-ask{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1.5px solid currentColor;box-sizing:border-box;font-weight:700;line-height:1;box-shadow:0 0 6px currentColor;animation:cfsp-pulse 1.8s ease-in-out infinite}',
      // An unread result: a filled check glowing in the success colour.
      '.cfsp-done{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:currentColor;box-sizing:border-box;box-shadow:0 0 7px currentColor}',
      '.cfsp-done::before{content:"✓";color:var(--dsw-alias-bg-base);font:700 9px/1 var(--dsw-font-family-code)}',
      // The pin at the right edge of every row: quiet while it is not set, loud
      // once its Session is pinned.
      '.cfsp-pin{opacity:.45;filter:grayscale(1);transition:opacity 120ms ease,filter 120ms ease}',
      '.cfsp-pin:hover,.cfsp-pin:focus-visible{opacity:1;filter:none}',
      '.cfsp-pin[data-pinned="true"]{opacity:1;filter:drop-shadow(0 0 3px var(--dsw-alias-state-warn-primary))}',
      // The comment under a pinned row: two italic lines, the rest in the tooltip.
      '.cfsp-item{display:flex;flex-direction:column;gap:2px}',
      '.cfsp-note{font-style:italic;font-size:11px;line-height:1.35;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}',
      '.cfsp-note:hover{color:var(--dsw-alias-label-primary)}',
      '.cfsp-note-add{opacity:0;transition:opacity 120ms ease}',
      '.cfsp-item:hover .cfsp-note-add,.cfsp-item:focus-within .cfsp-note-add{opacity:.65}',
      // The tag button of a row: quiet until the Session has tags, bright on hover.
      '@container (max-width: 420px){.cfsp-tag-label{display:none}.cfsp-ctx-tag{display:none}}',
      '.cfsp-tag-button{opacity:.45;filter:grayscale(1);transition:opacity 120ms ease,filter 120ms ease}',
      '.cfsp-tag-button:hover,.cfsp-tag-button:focus-visible{opacity:1;filter:none}',
      '.cfsp-tag-button[data-tagged="true"]{opacity:1;filter:none}',
      // The colour field of the tag manager: a swatch, not a browser default box.
      '.cfsp-tag-color{width:20px;height:20px;padding:0;border:0.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;cursor:pointer;overflow:hidden}',
      '.cfsp-tag-color::-webkit-color-swatch-wrapper{padding:0}',
      '.cfsp-tag-color::-webkit-color-swatch{border:none;border-radius:5px}',
    ].join('');

    /** Style element id, so a reloaded bundle never stacks duplicates. */
    const STYLE_ID = 'dsh-sessions-panel/sessions.css';

    /** Install the stylesheet once per document. */
    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) {
        return () => {};
      }
      const element = document.createElement('style');
      element.dataset.pluginCss = STYLE_ID;
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    /**
     * Styles. Theme tokens only, so a renamed token degrades but never breaks.
     */
    const S = {
      sessions: {
        // Fills the height the host seat gives it: the block is pinned to the foot of
        // the MCP page, and its list scrolls inside instead of leaving an empty band.
        flex: '1 1 auto', minHeight: 0,
        display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6,
        padding: '6px 6px 4px',
        borderTop: '0.5px solid var(--dsw-alias-border-l1)',
      },
      sessionsHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px 2px', color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      /**
       * The section title in that head: same scale as the other two panels, and the
       * section's disclosure control — a click folds the whole list away, exactly
       * like the catalogue above folds itself.
       */
      sessionsTitle: {
        flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0,
        border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 600,
      },
      /** The chevron of that control. */
      titleChevron: { flex: 'none', width: 10, fontSize: 9, color: 'var(--dsw-alias-label-secondary)' },
      /** The session count beside the word «Сессии». */
      counter: { flex: 'auto', minWidth: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      /** The «+ Новая сессия» action in that head, aligned to its right edge. */
      newSession: {
        marginLeft: 'auto', flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 10px', borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap',
      },
      /** The plus inside that button: a touch larger than the label. */
      newSessionPlus: { flex: 'none', fontSize: 15, lineHeight: 1 },
      sessionList: {
        display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        // The chips below react to this width: letters while there is room, dots
        // when the column is narrow.
        containerType: 'inline-size',
      },
      sessionRow: {
        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
        borderRadius: 'var(--dsw-radius-sm, 6px)', cursor: 'pointer',
      },
      /** A row whose title runs to a second line: everything else stays on line one. */
      sessionRowWide: {
        display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 6px',
        borderRadius: 'var(--dsw-radius-sm, 6px)', cursor: 'pointer',
      },
      sessionTag: {
        flex: 'none', padding: '0 3px', borderRadius: 999, fontSize: 10,
        color: 'var(--dsw-alias-label-tertiary)', border: '0.5px solid var(--dsw-alias-border-l1)',
      },
      sessionTitle: {
        minWidth: 0, flex: 'auto', color: 'var(--dsw-alias-label-primary)', fontSize: 12,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      /** Today's titles wrap to a second line instead of being cut. */
      sessionTitleWide: {
        minWidth: 0, flex: 'auto', color: 'var(--dsw-alias-label-primary)', fontSize: 12,
        lineHeight: '1.35', whiteSpace: 'normal', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      },
      /** The leading glyph, dot and time of a two-line row: aligned with its first line. */
      rowTop: { marginTop: 2 },
      /** The comment line under a pinned row: two italic lines, indented to the title. */
      noteLine: {
        margin: 0, padding: '0 8px 0 32px', border: 'none', background: 'transparent',
        width: '100%', boxSizing: 'border-box', textAlign: 'left', cursor: 'text',
      },
      /** The same line while it is being written: a two-row field of the same size. */
      noteEdit: {
        margin: 0, padding: '1px 6px', boxSizing: 'border-box', width: '100%', resize: 'none',
        border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        fontStyle: 'italic', fontSize: 11, lineHeight: '1.35', fontFamily: 'inherit',
      },
      /** The header button that opens the tag manager, next to «+ Новая сессия». */
      tagSettings: {
        flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '0.5px solid var(--dsw-alias-border-l2)', background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', font: 'inherit',
        fontSize: 12, lineHeight: 1,
      },
      /** The tag manager block under the session head. */
      tagManager: {
        display: 'flex', flexDirection: 'column', gap: 4, margin: '2px 6px 2px',
        padding: '6px 8px', border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'var(--dsw-alias-bg-layer-2)',
      },
      tagManagerHint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 10, lineHeight: 1.4 },
      tagManageRow: { display: 'flex', alignItems: 'center', gap: 6 },
      tagColor: {
        flex: 'none', width: 20, height: 20, padding: 0, border: 'none',
        background: 'transparent', cursor: 'pointer',
      },
      tagName: {
        flex: 'auto', minWidth: 0, height: 22, boxSizing: 'border-box', padding: '0 6px',
        border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        font: 'inherit', fontSize: 11,
      },
      tagDelete: {
        flex: 'none', width: 20, height: 20, padding: 0, border: 'none', background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: 11, lineHeight: 1,
      },
      tagAddButton: {
        flex: 'none', height: 22, padding: '0 8px', boxSizing: 'border-box',
        border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer', font: 'inherit', fontSize: 11, lineHeight: 1,
      },
      /** The cluster of tags in a row: clickable, opens the picker under the row. */
      tagCluster: {
        flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
        borderRadius: 999, font: 'inherit',
      },
      /** One of the reader's tags on a row, tinted with its own colour. */
      userTag: (color) => ({
        display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none',
        padding: '0 4px', borderRadius: 999, fontSize: 10, lineHeight: '14px',
        color: 'var(--dsw-alias-label-primary)',
        border: `0.5px solid color-mix(in srgb, ${color} 55%, transparent)`,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }),
      userTagDot: (color) => ({
        display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: color,
      }),
      /** The picker under a row: every known tag as a toggle. */
      tagPick: {
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 8px 2px 32px',
      },
      tagPickEmpty: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 10, padding: '2px 8px 2px 32px' },
      /** One toggle chip of the picker. */
      tagPickChip: (color, active) => ({
        display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 6px',
        borderRadius: 999, fontSize: 10, lineHeight: '16px', cursor: 'pointer', font: 'inherit',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        border: `0.5px solid ${active ? `color-mix(in srgb, ${color} 60%, transparent)` : 'var(--dsw-alias-border-l2)'}`,
        background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
      }),
      /** The tag button at the right edge of a row: the visible way to assign a tag. */
      tagButton: {
        flex: 'none', width: 18, height: 18, padding: 0, border: 'none', background: 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 11, lineHeight: 1, color: 'inherit',
      },
      /** The pin at the right edge of a row: a quiet glyph until its Session is pinned. */
      pin: {
        flex: 'none', width: 18, height: 18, padding: 0, border: 'none', background: 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 11, lineHeight: 1, color: 'inherit',
      },
      sessionWhen: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, whiteSpace: 'nowrap' },
      /** The colour dot a row leads with: the tag colour of the session's project. */
      dot: (tone) => ({
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        background: tone === undefined || tone === null || tone === '' ? 'var(--dsw-alias-label-tertiary)' : tone,
      }),
      /** One day bucket: its head and, when open, its rows. */
      group: { display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 },
      /**
       * A day bucket's head. It reads as a section, not as another row: its own
       * band, a heavier label, and the count on a chip, so the buckets do not blur
       * into one another.
       */
      groupHead: {
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
        padding: '3px 6px', border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'var(--dsw-alias-bg-layer-2)',
        cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', font: 'inherit',
        fontSize: 11, lineHeight: 1.5, textAlign: 'left',
      },
      /** The chevron that shows a bucket open or closed. */
      groupChevron: { flex: 'none', width: 10, color: 'var(--dsw-alias-label-secondary)', fontSize: 9 },
      groupLabel: { flex: 'none', fontWeight: 600, letterSpacing: '0.01em' },
      /** The row count of a bucket, on its own chip. */
      groupCount: {
        flex: 'none', marginLeft: 'auto', padding: '0 5px', borderRadius: 999,
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)',
        font: '10px/14px var(--dsw-font-family-code)', textAlign: 'center',
      },
      /** One bucket's rows. */
      groupBody: { display: 'flex', flexDirection: 'column', gap: 2 },
      /** Shown in place of the rows when the Harness reports no sessions. */
      note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, padding: '4px 0' },
    };

    /**
     * «На исполнении» is the live band above the days, so its head is tinted with the
     * business colour's tertiary surface and its label wears the primary one — one
     * accent, no second style language.
     */
    S.groupHeadCurrent = {
      ...S.groupHead,
      background: 'var(--dsw-alias-state-business-tertiary)',
      boxShadow: 'inset 3px 0 0 0 var(--dsw-alias-state-business-primary)',
    };
    S.groupLabelCurrent = { ...S.groupLabel, color: 'var(--dsw-alias-state-business-primary)' };

    /**
     * «Закреплённые» is the loudest band of the list and sits above everything: the
     * reader put those rows there on purpose, so the warm accent outranks the live
     * band and the row titles carry more weight.
     */
    S.groupHeadPinned = {
      ...S.groupHead,
      background: 'var(--dsw-alias-state-warn-tertiary)',
      boxShadow: 'inset 3px 0 0 0 var(--dsw-alias-state-warn-primary)',
    };
    S.groupLabelPinned = { ...S.groupLabel, color: 'var(--dsw-alias-state-warn-label)' };
    S.titlePinned = { fontWeight: 600 };

    /**
     * The time a row shows.
     *
     * The day buckets already say which day it is, so today's, yesterday's and the
     * day before's rows carry the clock only; anything older carries its date too,
     * because «Далее» spans many days. «На исполнении» spans days as well, so a row there
     * carries its date unless it is today's.
     */
    function whenTime(ms, bucket) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
      const at = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      // «Закреплённые» spans days, so a row says which day it is in words until the
      // words run out; a today row needs no word at all — just «14:05», then
      // «вчера 14:05», then the plain date.
      if (bucket === 'pinned') {
        const days = dayBucket(ms);
        if (days === 0) return time;
        if (days === 1) return `вчера ${time}`;
        if (days === 2) return `позавчера ${time}`;
        return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`;
      }
      if (bucket === 'current') return dayBucket(ms) === 0 ? time : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`;
      if (bucket === 'today' || bucket === 'yesterday' || bucket === 'before') return time;
      return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`;
    }

    /** A timestamp as the same day-relative words the data age uses. */
    function whenLabel(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
      const at = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
      if (days <= 0) return `сегодня ${time}`;
      if (days === 1) return `вчера ${time}`;
      if (days === 2) return `позавчера ${time}`;
      const date = `${pad(at.getDate())}.${pad(at.getMonth() + 1)}`;
      return at.getFullYear() === new Date().getFullYear() ? `${date} ${time}` : `${date}.${String(at.getFullYear()).slice(2)}`;
    }

    /**
     * The day bucket of a moment, as the list groups it.
     *
     * `0` is today, `1` yesterday, `2` the day before, and `null` anything older —
     * the calendar decides, so a session at 23:59 and one at 00:01 land apart.
     */
    function dayBucket(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
      const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const days = Math.round((midnight(new Date()) - midnight(new Date(ms))) / 86400000);
      if (days <= 0) return 0;
      if (days === 1) return 1;
      if (days === 2) return 2;
      return null;
    }

    /** Bucket labels, in the order the list shows them; «На исполнении» is prepended when it has rows. */
    const DAY_GROUPS = [
      { key: 'today', label: 'Сегодня' },
      { key: 'yesterday', label: 'Вчера' },
      { key: 'before', label: 'Позавчера' },
      { key: 'older', label: 'Далее' },
    ];

    /** The user's own band, above everything: sessions they pinned by hand. */
    const PINNED_GROUP = { key: 'pinned', label: 'Закреплённые' };

    /** The band above the days: sessions that want the reader now. */
    const CURRENT_GROUP = { key: 'current', label: 'На исполнении' };

    /**
     * Rows split into «На исполнении» and then day buckets, keeping the order they came in
     * (newest first).
     *
     * A session is current while its status is anything but idle: it is running, it
     * asked a question, or it finished and nobody has looked at the result yet. Such
     * a row leaves its day bucket, so a session is listed in exactly one place. The
     * band itself is ordered by the look's own rank — a question blocks the work, a
     * live session is next, an unread result can wait a moment — then by recency.
     *
     * Every bucket that has rows is returned; an empty one is left out so the head
     * never sits over nothing.
     */
    function groupRows(rows, statuses, activeId, pins) {
      const pinnedRows = [];
      const live = [];
      const byBucket = new Map();
      for (const row of rows) {
        const look = rowLook(statuses, row.id, activeId);
        // Work in progress outranks the pin: a pinned Session the AI is running moves
        // to «На исполнении» so the turn is visible, and returns to «Закреплённые» the moment
        // it ends. The pin itself is never touched.
        if (look === SESSION_LOOK.running) {
          live.push({ id: row.id, summary: row.summary, rank: look.rank });
          continue;
        }
        // Otherwise a pin wins over every derived band: the reader said where it belongs.
        if (pins !== null && pins !== undefined && pins.has(String(row.id))) {
          pinnedRows.push(row);
          continue;
        }
        if (look !== SESSION_LOOK.idle) {
          live.push({ id: row.id, summary: row.summary, rank: look.rank });
          continue;
        }
        const bucket = dayBucket(Number(row.summary.updatedAt));
        const key = bucket === 0 ? 'today' : bucket === 1 ? 'yesterday' : bucket === 2 ? 'before' : 'older';
        const list = byBucket.get(key) ?? [];
        list.push(row);
        byBucket.set(key, list);
      }
      const newest = (left, right) => (Number(right.summary.updatedAt) || 0) - (Number(left.summary.updatedAt) || 0);
      pinnedRows.sort(newest);
      live.sort((left, right) => (left.rank - right.rank) || newest(left, right));
      return [
        ...(pinnedRows.length === 0 ? [] : [{ ...PINNED_GROUP, rows: pinnedRows }]),
        ...(live.length === 0 ? [] : [{ ...CURRENT_GROUP, rows: live }]),
        ...DAY_GROUPS
          .map((group) => ({ ...group, rows: byBucket.get(group.key) ?? [] }))
          .filter((group) => group.rows.length > 0),
      ];
    }

    /**
     * What a session row leads with. The harness publishes three independent
     * facts per session — running, a pending interaction, and an unread
     * completion. A question outranks the running flag: a turn that is waiting for
     * the reader is not moving, and the reader is the one who has to act. `rank`
     * orders the «На исполнении» band; `key` picks the glyph the row draws.
     */
    const SESSION_LOOK = {
      running: { key: 'running', rank: 1, glyph: '', tone: 'var(--dsw-alias-state-business-primary)', label: 'работает' },
      asking: { key: 'asking', rank: 0, glyph: '?', tone: 'var(--dsw-alias-state-warn-primary)', label: 'ждёт ответа' },
      done: { key: 'done', rank: 2, glyph: '', tone: 'var(--dsw-alias-state-success-primary)', label: 'готово, не просмотрено' },
      // An idle row keeps the status slot empty: the quiet is the message, and the
      // project colour dot beside it is left to lead the row on its own.
      idle: { key: 'idle', rank: 9, glyph: '', tone: 'var(--dsw-alias-state-idle-primary)', label: 'без активности' },
    };

    /**
     * The access mode a row's title wears: reading is safe and wears the green, full
     * access is the dangerous one and wears the red, and the ordinary
     * `workspace-write` keeps the plain colour so the list stays calm. The tint is
     * mixed with the label colour, so one token reads on both themes.
     */
    const ACCESS_TONE = {
      'read-only': 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 78%, var(--dsw-alias-label-primary))',
      'danger-full-access': 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, var(--dsw-alias-label-primary))',
    };

    /** What the tooltip calls each access mode. */
    const ACCESS_LABEL = {
      'read-only': 'только чтение',
      'workspace-write': 'запись в рабочей папке',
      'danger-full-access': 'полный доступ',
    };

    /**
     * The access preset a Session carries, or '' when the deployment composes no
     * permission service. The list row keeps the folded projection under
     * `projectionValues.permissions.currentValue`.
     */
    function accessPreset(summary) {
      const values = summary === null || summary === undefined ? undefined : summary.projectionValues;
      const permissions = values === null || values === undefined ? undefined : values.permissions;
      return permissions !== null && permissions !== undefined && typeof permissions.currentValue === 'string'
        ? permissions.currentValue
        : '';
    }

    /** One session's indicator, from the published status map. */
    function sessionLook(statuses, id) {
      const entry = statuses === null || statuses === undefined || typeof statuses.get !== 'function' ? undefined : statuses.get(id);
      if (entry === null || entry === undefined) return SESSION_LOOK.idle;
      if (entry.pendingInteraction !== undefined && entry.pendingInteraction !== null) return SESSION_LOOK.asking;
      if (entry.running === true) return SESSION_LOOK.running;
      if (entry.completionUnread === true) return SESSION_LOOK.done;
      return SESSION_LOOK.idle;
    }

    /**
     * The look a row actually draws.
     *
     * The Session on screen has no unread result: the reader is looking at it, so a
     * finished turn there is not news. The platform may keep the flag until the
     * reader leaves the Session, and a row that keeps a green mark and stays in
     * «На исполнении» while its turn is over reads as a stuck list — so the flag is
     * ignored for the Session the main view is showing. A question and a running
     * turn still count: those want the reader even when they are right here.
     */
    function rowLook(statuses, id, activeId) {
      const look = sessionLook(statuses, id);
      if (look !== SESSION_LOOK.done) return look;
      if (activeId === undefined || activeId === null) return look;
      return String(activeId) === String(id) ? SESSION_LOOK.idle : look;
    }

    /**
     * The cfsmcp2 labels a Session carries, read from its working directory.
     *
     * Two passes, because a portfolio folder is not a context:
     *
     *   1. a context whose name is a whole path segment — the longest name wins,
     *      so `shop_a` beats `shop`; its own tags become the row's chips;
     *   2. no context matched — a tag whose name is a whole path segment, the
     *      deepest one, so `/Users/alex/work/tmp` is labelled `work` and
     *      `/Users/alex/src/print` is labelled `print`.
     *
     * A Session outside every known name simply has no labels.
     */
    function labelForCwd(cwd, contexts, tagNames) {
      if (typeof cwd !== 'string' || cwd === '') return { context: null, tag: null };
      const segments = cwd.split('/').filter((part) => part !== '').map((part) => part.toLowerCase());
      let best = null;
      for (const context of contexts) {
        const name = String(context.name).toLowerCase();
        if (!segments.includes(name)) continue;
        if (best === null || name.length > best.name.length) best = context;
      }
      // The tag pass runs either way: a matched context may carry no tags of its own,
      // and then the folder's tag is still better than a blank chip.
      let tag = null;
      let depth = -1;
      for (const name of tagNames) {
        const key = String(name).toLowerCase();
        const at = segments.lastIndexOf(key);
        if (at < 0) continue;
        if (at > depth || (at === depth && key.length > String(tag).length)) {
          tag = name;
          depth = at;
        }
      }
      return { context: best, tag };
    }

    /**
     * The cfsmcp2 catalogue, fetched once while the seat is visible.
     *
     * Only the project colour and the tags of a session row come from it, so the
     * shape here is deliberately small: `{ contexts, tags }`. A failed read leaves
     * both empty — rows then render without tags instead of an error.
     */
    function useCatalogue(enabled) {
      const [state, setState] = React.useState({ phase: 'idle', data: null, error: null });
      React.useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        (async () => {
          try {
            const response = await fetch(ROUTE, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (cancelled) return;
            setState({
              phase: 'ready',
              data: {
                contexts: Array.isArray(payload?.contexts) ? payload.contexts : [],
                tags: Array.isArray(payload?.tags) ? payload.tags : [],
              },
              error: null,
            });
          } catch (error) {
            if (cancelled) return;
            setState({ phase: 'error', data: null, error: error instanceof Error ? error.message : String(error) });
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [enabled]);
      return { state };
    }

    /**
     * The session list: every session, newest first, led by its status, the colour
     * cfsmcp2 gives the context it belongs to, that context's tags, and the name
     * the sidebar shows. A click reveals the session in the main view.
     */
    function SessionsPanel(props) {
      const given = Array.isArray(props.contexts) ? props.contexts : null;
      const visible = props.visible !== false;
      // A caller that already holds the catalogue passes it; otherwise fetch one.
      const { state } = useCatalogue(given === null && visible);
      const fetched = state.data !== null && state.data !== undefined ? state.data : null;
      const contexts = given !== null ? given : (fetched !== null && Array.isArray(fetched.contexts) ? fetched.contexts : []);
      const colours = props.tagColours instanceof Map
        ? props.tagColours
        : new Map((fetched !== null && Array.isArray(fetched.tags) ? fetched.tags : []).map((tag) => [tag.tag, tag.color]));
      // Tag names for the folder fallback; the Host merges the full REST catalogue,
      // so a tag without contexts of its own (`z`, `vs`) is here too.
      const tagNames = [...colours.keys()];

      const readSessions = typeof props.useSessions === 'function'
        ? props.useSessions
        : (select) => select({ ids: [], byId: {}, phase: 'unavailable' });
      const readStatus = typeof props.useSessionStatus === 'function'
        ? props.useSessionStatus
        : () => undefined;
      // Which day buckets the reader closed. A bucket closes on a click on its head,
      // and the state lives with the panel: it is a reading aid, not a setting.
      const [collapsed, setCollapsed] = usePanelSet('buckets');
      // The sessions the reader pinned. Unlike the folding state this is a choice
      // about the list itself, so it is remembered too — but it is still the
      // reader's, not a Session's.
      const [pins, setPins] = usePanelSet('pins');
      // The reader's own tags: a catalogue in the header, assignment on a row.
      const sessionTags = usePanelTags();
      const [managingTags, setManagingTags] = React.useState(false);
      const [tagging, setTagging] = React.useState(null);
      const [newTagName, setNewTagName] = React.useState('');
      const [newTagColor, setNewTagColor] = React.useState(TAG_PALETTE[0]);
      // The export: an on-demand file for a period, the previous month by default.
      const [exportOpen, setExportOpen] = React.useState(false);
      const [exportFrom, setExportFrom] = React.useState(() => previousMonth().from);
      const [exportTo, setExportTo] = React.useState(() => previousMonth().to);
      const [exportBusy, setExportBusy] = React.useState(null);
      const [exportStatus, setExportStatus] = React.useState('');
      const tagById = new Map(sessionTags.tags.map((tag) => [tag.id, tag]));
      // A pinned row may carry one short comment. The editor replaces the line in
      // place, so writing it never costs a dialog.
      const [notes, setNote] = usePanelNotes();
      const [editing, setEditing] = React.useState(null);
      const [draft, setDraft] = React.useState('');
      const noteCancel = React.useRef(false);
      // The whole section folds from its own head, the way the catalogue does.
      const [closedSection, setClosedSection] = usePanelFlag('sessions');
      const list = readSessions((value) => value) ?? { ids: [], byId: {} };
      const statuses = readStatus((value) => value);
      // The Session drawn in the main view right now: the sidebar marks it by
      // retaining it for the main view, so the list can say «вы здесь» without
      // relying on the seat's own props.
      const activeId = readSessions((value) => {
        const byId = value === null || value === undefined ? null : value.byId;
        if (byId === null || typeof byId !== 'object') return undefined;
        for (const candidate of Object.keys(byId)) {
          if ((Number(byId[candidate]?.retainedBy?.mainView) || 0) > 0) return candidate;
        }
        return undefined;
      }) ?? (typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined);

      const rows = [];
      for (const id of Array.isArray(list.ids) ? list.ids : []) {
        const summary = list.byId === null || list.byId === undefined ? undefined : list.byId[id];
        if (summary === undefined || summary === null) continue;
        // An empty Session is a placeholder the reader never wrote into — usually an
        // abandoned «+ Новая сессия». It has nothing to show, so it is not listed.
        if (summary.blank === true) continue;
        rows.push({ id, summary });
      }
      rows.sort((left, right) => (Number(right.summary.updatedAt) || 0) - (Number(left.summary.updatedAt) || 0));

      const reveal = (id) => {
        try {
          if (platform !== null) platform.uiWorkspace.openSession(id);
        } catch {
          // Revealing a session is the whole point of the row, but a refusal is
          // not worth an error banner over the catalogue.
        }
      };

      /** Open the comment editor on one row, with the text it already carries. */
      const beginNote = (id, text) => {
        setEditing(String(id));
        setDraft(typeof text === 'string' ? text : '');
      };

      /** Store what the field holds and close it; an empty comment removes the note. */
      const saveNote = (id) => {
        setNote(id, draft);
        setEditing(null);
        setDraft('');
      };

      /** Add the tag the header form holds and step the palette on. */
      const addTag = () => {
        const name = newTagName.trim();
        if (name === '') return;
        sessionTags.create(name, newTagColor);
        setNewTagName('');
        setNewTagColor(TAG_PALETTE[(sessionTags.tags.length + 1) % TAG_PALETTE.length]);
      };

      /** Open or close the tag picker under one row. */
      const toggleTagging = (id) => {
        const key = String(id);
        setTagging((previous) => (previous === key ? null : key));
      };

      /**
       * Collect the activity of the period from the Host, put the labels of this
       * panel on every row and have the Host write the file into ~/Downloads.
       */
      const runExport = async (format) => {
        if (exportBusy !== null) return;
        setExportBusy(format);
        setExportStatus('читаю журналы сессий…');
        try {
          const parameters = new URLSearchParams({ from: exportFrom, to: exportTo });
          const response = await fetch(`api/sessions-activity?${parameters.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(response.status === 404
              ? 'Host не знает api/sessions-activity — приложение запущено со старым Host, нужен полный перезапуск (Cmd+Q)'
              : `HTTP ${response.status}`);
          }
          const activity = await response.json();
          if (activity?.ok !== true) throw new Error(typeof activity?.error === 'string' ? activity.error : 'не удалось прочитать журналы');
          const sessions = Array.isArray(activity.sessions) ? activity.sessions : [];
          const rows = sessions.map((session) => {
            const label = labelForCwd(session.cwd, contexts, tagNames);
            const cfsmcp2 = label.context !== null && label.context.tags.length > 0
              ? label.context.tags.slice(0, 3)
              : (label.tag === null ? [] : [label.tag]);
            const tags = sessionTags.ids(session.id)
              .map((tagId) => tagById.get(tagId))
              .filter((tag) => tag !== undefined)
              .map((tag) => tag.name);
            return {
              session: typeof session.title === 'string' && session.title !== '' ? session.title : `сессия ${String(session.id).slice(0, 8)}`,
              cfsmcp2,
              tags,
              start: Number(session.start) || 0,
              end: Number(session.end) || 0,
              activeMs: Number(session.activeMs) || 0,
            };
          });
          setExportStatus(`сессий: ${rows.length}, пишу файл…`);
          const written = await fetch('api/sessions-export', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ format, period: { from: exportFrom, to: exportTo }, rows }),
          });
          if (!written.ok) {
            throw new Error(written.status === 404
              ? 'Host не знает api/sessions-export — нужен полный перезапуск приложения (Cmd+Q)'
              : `HTTP ${written.status}`);
          }
          const result = await written.json();
          if (result?.ok !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'файл не записан');
          setExportStatus(result.opened === true ? `сохранено и открыто: ${result.path}` : `сохранено: ${result.path}`);
        } catch (error) {
          setExportStatus(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          setExportBusy(null);
        }
      };

      /** Pin or unpin one Session; a pinned row always lives in «Закреплённые». */
      const togglePin = (id) => {
        const key = String(id);
        setPins((previous) => {
          const next = new Set(previous);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      };

      return h('div', { style: S.sessions },
        h('div', { style: S.sessionsHead },
          h('button', {
            type: 'button',
            style: S.sessionsTitle,
            'data-section': 'sessions',
            'aria-expanded': closedSection ? 'false' : 'true',
            title: closedSection ? 'Развернуть «Сессии»' : 'Свернуть «Сессии»',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setClosedSection((previous) => !previous);
            },
          }, [
            h('span', { key: 'chevron', style: S.titleChevron, 'aria-hidden': true }, closedSection ? '▸' : '▾'),
            h('span', { key: 'label' }, 'Сессии'),
          ]),
          h('span', { style: S.counter }, rows.length === 0 ? '…' : String(rows.length)),
          h('button', {
            type: 'button',
            className: 'cfsp-new',
            style: S.newSession,
            title: 'Новая сессия',
            'aria-label': 'Новая сессия',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              const start = platform === null || platform === undefined || platform.uiWorkspace === undefined
                ? undefined
                : platform.uiWorkspace.startSession;
              if (typeof start !== 'function') return;
              try {
                // No draft: the platform composes a blank Session in the current
                // workspace. A refusal is not worth an error banner over the list.
                start.call(platform.uiWorkspace, undefined);
              } catch {
                // ignored on purpose
              }
            },
          }, [
            h('span', { key: 'plus', style: S.newSessionPlus, 'aria-hidden': true }, '+'),
            h('span', { key: 'label' }, 'Новая сессия'),
          ]),
          h('button', {
            type: 'button',
            className: 'cfsp-tags',
            style: S.tagSettings,
            'data-section': 'session-tags',
            'aria-expanded': managingTags ? 'true' : 'false',
            title: managingTags ? 'Скрыть метки сессий' : 'Метки сессий',
            'aria-label': 'Метки сессий',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setManagingTags((previous) => !previous);
            },
          }, h('span', { 'aria-hidden': true }, '🏷')),
          h('button', {
            type: 'button',
            className: 'cfsp-export',
            style: S.tagSettings,
            'data-section': 'session-export',
            'aria-expanded': exportOpen ? 'true' : 'false',
            title: 'Экспорт сессий за период',
            'aria-label': 'Экспорт сессий за период',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setExportOpen((previous) => !previous);
              setExportStatus('');
            },
          }, h('span', { 'aria-hidden': true }, '⤓')),
        ),
        !closedSection && exportOpen
          ? h('div', { key: 'export-panel', style: S.tagManager, 'data-export-panel': 'true' },
            h('div', { style: S.tagManagerHint },
              'Период по умолчанию — предыдущий месяц. Активное время считается по ходам агента; файл пишется в ~/Downloads.'),
            h('div', { style: S.tagManageRow },
              h('input', {
                type: 'date',
                style: S.tagName,
                value: exportFrom,
                'data-export-from': 'true',
                'aria-label': 'Начало периода',
                onChange: (event) => setExportFrom(event.target.value),
              }),
              h('input', {
                type: 'date',
                style: S.tagName,
                value: exportTo,
                'data-export-to': 'true',
                'aria-label': 'Конец периода',
                onChange: (event) => setExportTo(event.target.value),
              }),
            ),
            h('div', { style: S.tagManageRow },
              h('button', {
                type: 'button',
                style: S.tagAddButton,
                disabled: exportBusy !== null,
                'data-export-json': 'true',
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void runExport('json');
                },
              }, exportBusy === 'json' ? '…' : 'JSON'),
              h('button', {
                type: 'button',
                style: S.tagAddButton,
                disabled: exportBusy !== null,
                'data-export-xlsx': 'true',
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void runExport('xlsx');
                },
              }, exportBusy === 'xlsx' ? '…' : 'Excel'),
            ),
            exportStatus === ''
              ? null
              : h('div', { style: { ...S.tagManagerHint, whiteSpace: 'pre-line' }, 'data-export-status': 'true' }, exportStatus),
          )
          : null,
        !closedSection && managingTags
          ? h('div', { key: 'tag-manager', style: S.tagManager, 'data-tag-manager': 'true' },
            h('div', { style: S.tagManagerHint },
              'Метки задаются здесь и ниоткуда не импортируются. Нажмите 🏷 в строке сессии, чтобы отметить её.'),
            sessionTags.tags.map((tag) => h('div', { key: tag.id, style: S.tagManageRow, 'data-tag-row': tag.id },
              h('input', {
                type: 'color',
                className: 'cfsp-tag-color',
                style: S.tagColor,
                value: tag.color,
                'aria-label': `Цвет метки ${tag.name}`,
                onChange: (event) => sessionTags.update(tag.id, { color: event.target.value }),
              }),
              h('input', {
                style: S.tagName,
                defaultValue: tag.name,
                'aria-label': `Имя метки ${tag.name}`,
                onBlur: (event) => sessionTags.update(tag.id, { name: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                },
              }),
              h('button', {
                type: 'button',
                style: S.tagDelete,
                title: 'Удалить метку',
                'aria-label': `Удалить метку ${tag.name}`,
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  sessionTags.remove(tag.id);
                },
              }, '✕'),
            )),
            h('div', { style: S.tagManageRow },
              h('input', {
                type: 'color',
                className: 'cfsp-tag-color',
                style: S.tagColor,
                value: newTagColor,
                'aria-label': 'Цвет новой метки',
                onChange: (event) => setNewTagColor(event.target.value),
              }),
              h('input', {
                style: S.tagName,
                placeholder: 'новая метка',
                value: newTagName,
                'aria-label': 'Имя новой метки',
                onChange: (event) => setNewTagName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') addTag();
                },
              }),
              h('button', {
                type: 'button',
                style: S.tagAddButton,
                disabled: newTagName.trim() === '',
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  addTag();
                },
              }, 'Добавить'),
            ),
          )
          : null,
        closedSection
          ? null
          : rows.length === 0
          ? h('div', { key: 'empty', style: S.note },
            list !== null && list.phase === 'ready' ? 'нет сессий' : 'список сессий недоступен')
          : h('div', { key: 'list', style: S.sessionList }, groupRows(rows, statuses, activeId, pins).map((group) => {
            const closed = collapsed.has(group.key);
            return h('div', { key: group.key, style: S.group },
              h('button', {
                type: 'button',
                style: group.key === 'pinned' ? S.groupHeadPinned
                  : group.key === 'current' ? S.groupHeadCurrent
                  : S.groupHead,
                'data-group': group.key,
                'aria-expanded': closed ? 'false' : 'true',
                title: closed ? `Развернуть «${group.label}»` : `Свернуть «${group.label}»`,
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  });
                },
              }, [
                h('span', { key: 'chevron', style: S.groupChevron, 'aria-hidden': true }, closed ? '▸' : '▾'),
                h('span', {
                  key: 'label',
                  style: group.key === 'pinned' ? S.groupLabelPinned
                    : group.key === 'current' ? S.groupLabelCurrent
                    : S.groupLabel,
                }, group.label),
                h('span', { key: 'count', style: S.groupCount }, String(group.rows.length)),
              ]),
              closed ? null : h('div', { key: 'body', style: S.groupBody }, group.rows.map(({ id, summary }) => {
                const look = rowLook(statuses, id, activeId);
                const label = labelForCwd(summary.cwd, contexts, tagNames);
                const context = label.context;
                const tags = context !== null && context.tags.length > 0
                  ? context.tags.slice(0, 3)
                  : (label.tag === null ? [] : [label.tag]);
                const colour = tags.length === 0 ? null : colours.get(tags[0]) ?? null;
                const title = typeof summary.title === 'string' && summary.title !== '' ? summary.title : String(id).slice(0, 8);
                // The comment follows the pin: it is shown as a line under a pinned row
                // and only in this tooltip once the row is back in its own band.
                const note = typeof notes[String(id)] === 'string' ? notes[String(id)] : '';
                const preset = accessPreset(summary);
                const accessColour = ACCESS_TONE[preset] ?? null;
                const wide = group.key === 'current' || group.key === 'today';
                // The reader's tags first — they are the point of the row — then the
                // tags derived from the cwd. Only as many as the row can hold.
                const mine = sessionTags.ids(id).map((tagId) => tagById.get(tagId)).filter((tag) => tag !== undefined);
                const shownMine = mine.slice(0, wide ? 3 : 2);
                const shownContexts = tags.slice(0, wide ? 3 : 2);
                const taggingThis = tagging !== null && String(tagging) === String(id);
                const editingThis = editing !== null && String(editing) === String(id);
                // The tooltip leads with the full name — that is what a reader hovering
                // a row is after — then where and when the session last ran.
                const here = activeId !== undefined && String(activeId) === String(id);
                const detail = [
                  title,
                  `cwd: ${typeof summary.cwd === 'string' ? summary.cwd : '—'}`,
                  `${look.label} · ${whenLabel(Number(summary.updatedAt))}`,
                  context === null
                    ? (label.tag === null ? 'контекст: —' : `метка по папке: ${label.tag}`)
                    : `контекст: ${context.name}` + (context.tags.length === 0 && label.tag !== null ? ` (метка по папке: ${label.tag})` : ''),
                  preset === '' ? null : `доступ: ${ACCESS_LABEL[preset] ?? preset}`,
                  note === '' ? null : `комментарий: ${note}`,
                  here ? 'открыта сейчас' : null,
                ].filter((line) => line !== null).join('\n');
                const row = h('div', {
                  key: 'row',
                  className: ['cfsp-session', look.key === 'running' ? 'cfsp-live' : null, here ? 'cfsp-here' : null]
                    .filter((name) => name !== null).join(' '),
                  style: wide ? S.sessionRowWide : S.sessionRow,
                  role: 'button',
                  tabIndex: 0,
                  title: detail,
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setTagging(null);
                    reveal(id);
                  },
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    reveal(id);
                  },
                },
                  h('span', {
                    // The glyph is the status: a turning ring for a live session, a
                    // breathing «?» for a question, a glowing check for an unread
                    // result. Classes carry the motion, the inline colour carries the
                    // tone, so both themes read correctly.
                    className: look.key === 'running' ? 'cfsp-run'
                      : look.key === 'asking' ? 'cfsp-ask'
                      : look.key === 'done' ? 'cfsp-done'
                      : undefined,
                    'data-state': look.key,
                    'aria-hidden': true,
                    style: {
                      flex: 'none', boxSizing: 'border-box',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: look.key === 'running' ? 15 : 14, height: look.key === 'running' ? 15 : 14,
                      textAlign: 'center', lineHeight: 1,
                      fontSize: look.key === 'asking' ? 10 : 11,
                      color: look.tone,
                      marginTop: wide ? 1 : 0,
                    },
                  }, look.key === 'running' || look.key === 'done' ? null : look.glyph),
                  h('span', {
                    style: {
                      ...S.dot(colour === null ? 'var(--dsw-alias-label-tertiary)' : colour),
                      marginTop: wide ? 6 : 0,
                    },
                  }),
                  h('span', {
                    style: {
                      ...(wide ? S.sessionTitleWide : S.sessionTitle),
                      ...(group.key === 'pinned' ? S.titlePinned : null),
                      ...(accessColour === null ? null : { color: accessColour }),
                    },
                    'data-access': preset === '' ? undefined : preset,
                    title,
                  }, title),
                  h('span', {
                    key: 'tags',
                    className: 'cfsp-tag-cluster',
                    role: 'button',
                    tabIndex: 0,
                    style: S.tagCluster,
                    'data-tagged': mine.length === 0 ? 'false' : 'true',
                    title: mine.length === 0 ? 'Отметить сессию' : `Метки: ${mine.map((tag) => tag.name).join(', ')}`,
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleTagging(id);
                    },
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      toggleTagging(id);
                    },
                  }, [
                    ...shownMine.map((tag) => h('span', { key: tag.id, style: S.userTag(tag.color), title: tag.name }, [
                      h('span', { key: 'dot', style: S.userTagDot(tag.color) }),
                      h('span', { key: 'label', className: 'cfsp-tag-label' }, tag.name),
                    ])),
                    ...shownContexts.map((tag) => h('span', { key: `ctx-${tag}`, className: 'cfsp-ctx-tag', style: S.sessionTag }, tag)),
                  ]),
                  h('span', {
                    style: { ...S.sessionWhen, marginTop: wide ? 1 : 0 },
                  }, whenTime(Number(summary.updatedAt), group.key)),
                  h('button', {
                    key: 'tag-button',
                    type: 'button',
                    className: 'cfsp-tag-button',
                    'data-tag-button': 'true',
                    'data-tagged': mine.length === 0 ? 'false' : 'true',
                    style: { ...S.tagButton, marginTop: wide ? 1 : 0 },
                    title: mine.length === 0 ? 'Назначить метку' : `Метки: ${mine.map((tag) => tag.name).join(', ')}`,
                    'aria-label': mine.length === 0 ? 'Назначить метку' : 'Изменить метки',
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleTagging(id);
                    },
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.stopPropagation();
                    },
                  }, '🏷'),
                  h('button', {
                    key: 'pin',
                    type: 'button',
                    className: 'cfsp-pin',
                    'data-pinned': pins.has(String(id)) ? 'true' : 'false',
                    style: { ...S.pin, marginTop: wide ? 1 : 0 },
                    title: pins.has(String(id)) ? 'Открепить' : 'Закрепить',
                    'aria-label': pins.has(String(id)) ? 'Открепить' : 'Закрепить',
                    'aria-pressed': pins.has(String(id)) ? 'true' : 'false',
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      togglePin(id);
                    },
                    onKeyDown: (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.stopPropagation();
                    },
                  }, '📌'),
                );

                // The comment: two italic lines under a pinned row, an in-place field
                // while it is written, and nothing at all once the row leaves the band.
                const noteNode = editingThis
                  ? h('textarea', {
                    key: 'note-edit',
                    style: S.noteEdit,
                    value: draft,
                    rows: 2,
                    maxLength: 300,
                    autoFocus: true,
                    placeholder: 'краткий комментарий',
                    'aria-label': 'Комментарий к закреплённой сессии',
                    onChange: (event) => setDraft(event.target.value),
                    onBlur: () => {
                      if (noteCancel.current) {
                        noteCancel.current = false;
                        setEditing(null);
                        setDraft('');
                        return;
                      }
                      saveNote(id);
                    },
                    onKeyDown: (event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        noteCancel.current = true;
                        event.currentTarget.blur();
                      }
                    },
                    onClick: (event) => event.stopPropagation(),
                  })
                  : note !== ''
                  ? h('button', {
                    key: 'note',
                    type: 'button',
                    className: 'cfsp-note',
                    style: S.noteLine,
                    title: note,
                    'aria-label': 'Изменить комментарий',
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginNote(id, note);
                    },
                    onKeyDown: (event) => event.stopPropagation(),
                  }, note)
                  : h('button', {
                    key: 'note-add',
                    type: 'button',
                    className: 'cfsp-note cfsp-note-add',
                    style: S.noteLine,
                    title: 'Короткий комментарий к закреплённой',
                    'aria-label': 'Добавить комментарий',
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginNote(id, '');
                    },
                    onKeyDown: (event) => event.stopPropagation(),
                  }, '+ комментарий');

                // The picker sits under the row, like the comment editor: every known
                // tag as a toggle, and a hint when the catalogue is still empty.
                const tagPicker = h('div', {
                  key: 'tag-pick',
                  className: 'cfsp-tag-pick',
                  style: S.tagPick,
                  'data-tag-pick': 'true',
                }, sessionTags.tags.length === 0
                  ? h('span', { key: 'none', style: S.tagPickEmpty }, 'меток нет — создайте их кнопкой «Метки» в шапке')
                  : sessionTags.tags.map((tag) => {
                    const active = mine.some((own) => own.id === tag.id);
                    return h('button', {
                      key: tag.id,
                      type: 'button',
                      style: S.tagPickChip(tag.color, active),
                      'aria-pressed': active ? 'true' : 'false',
                      'data-tag-id': tag.id,
                      onClick: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        sessionTags.toggle(id, tag.id);
                      },
                    }, [
                      h('span', { key: 'dot', style: S.userTagDot(tag.color) }),
                      tag.name,
                    ]);
                  }));

                return h('div', { key: id, className: 'cfsp-item' }, [
                  row,
                  group.key === 'pinned' ? noteNode : null,
                  taggingThis ? tagPicker : null,
                ]);
              })),
            );
          })),
      );
    }

      return { component: SessionsPanel, installStyles };
    })();

    // ── LM Studio: the models loaded right now ────────────────────────────────
    const ModelsSection = (() => {
    /**
     * The Host route that asks LM Studio. The browser never calls port 1234 itself:
     * the Host half fetches `api/v0/models` and hands back a small, stable shape, so
     * the panel needs neither CORS from LM Studio nor knowledge of its API version.
     */
    const ROUTE = 'api/lmstudio';
    /** How often the loaded set is re-read. Loading a model is a rare, slow act. */
    const POLL_MS = 10000;

    /**
     * Styles. The same measurements as the session list, so the block reads as one
     * column; the head turns into a coloured band when there is nothing to serve.
     */
    const S = {
      models: {
        // No top margin: the catalogue above already ends in a hairline, and this
        // block's own border sits on it, so the column keeps one divider, not two.
        flex: 'none', display: 'flex', flexDirection: 'column', gap: 2,
        padding: '6px 6px 4px', borderTop: '0.5px solid var(--dsw-alias-border-l1)',
      },
      head: {
        display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px',
        borderRadius: 'var(--dsw-radius-sm, 6px)', fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)', transition: 'background-color 160ms ease',
      },
      /** The section's disclosure control: the title and its chevron. */
      title: {
        flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0,
        border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 600,
      },
      titleChevron: { flex: 'none', width: 10, fontSize: 9, color: 'var(--dsw-alias-label-secondary)' },
      counter: { flex: 'auto', minWidth: 0, marginLeft: 'auto', textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap' },
      row: {
        display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
      },
      name: {
        minWidth: 0, flex: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      },
      meta: { flex: 'none', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
      note: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, padding: '3px 6px 1px', whiteSpace: 'pre-line' },
      list: { display: 'flex', flexDirection: 'column', gap: 2 },
    };

    /** A context length in the compact form the rows show: 2048 → 2k, 262144 → 256k. */
    function contextLabel(value) {
      const size = Number(value);
      if (!Number.isFinite(size) || size <= 0) return '';
      if (size < 1024) return String(size);
      return `${Math.round(size / 1024)}k`;
    }

    /** What a row says on the right: the quantisation and the context. */
    function modelMeta(model) {
      const parts = [];
      if (typeof model.quantization === 'string' && model.quantization !== '') parts.push(model.quantization);
      const context = contextLabel(model.loadedContext ?? model.maxContext);
      if (context !== '') parts.push(context);
      return parts.join(' · ');
    }

    /** The loaded set, re-read while the seat is visible. */
    function useModels(enabled) {
      const [state, setState] = React.useState({ phase: 'idle', data: null, error: null });
      React.useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        let timer = null;
        const load = async () => {
          try {
            const response = await fetch(ROUTE, { credentials: 'same-origin' });
            // A non-2xx answer is the Host refusing the route — the panel has three
            // different failures to name, and this is not «LM Studio is down».
            if (!response.ok) {
              if (cancelled) return;
              setState({
                phase: 'error',
                reason: 'route',
                data: null,
                error: `Host ответил HTTP ${response.status} на ${ROUTE}`,
              });
              return;
            }
            const payload = await response.json();
            if (cancelled) return;
            setState(payload?.ok === true
              ? { phase: 'ready', reason: null, data: payload, error: null }
              : {
                  phase: 'error',
                  reason: 'lmstudio',
                  data: null,
                  error: typeof payload?.error === 'string' ? payload.error : 'LM Studio не отвечает',
                });
          } catch (error) {
            if (cancelled) return;
            setState({ phase: 'error', reason: 'network', data: null, error: error instanceof Error ? error.message : String(error) });
          } finally {
            if (!cancelled) timer = setTimeout(load, POLL_MS);
          }
        };
        void load();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [enabled]);
      return state;
    }

    /** Russian plural of a counted noun: 1 эмбеддинг, 2 эмбеддинга, 5 эмбеддингов. */
    function plural(count, one, few, many) {
      const last = count % 10;
      const lastTwo = count % 100;
      if (last === 1 && lastTwo !== 11) return one;
      if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
      return many;
    }

    /**
     * The embedding models the local LM Studio has loaded right now.
     *
     * Chat models are not interesting here: the panel exists to answer one question —
     * are the embeddings the MCP servers need in memory? So only `type: embeddings`
     * rows are listed, and the head is a status line:
     *
     *   an embedding is loaded            quiet, «N эмбеддинга»
     *   models are loaded, none is an embedding  red, «нет эмбеддинга», the LLM named below
     *   LM Studio does not answer         red, «нет связи»
     *   the Host does not know the route  red, «нет маршрута»
     */
    function ModelsPanel(props) {
      const visible = props.visible !== false;
      const state = useModels(visible);
      const [closedSection, setClosedSection] = usePanelFlag('models');

      const models = state.data !== null && Array.isArray(state.data.models) ? state.data.models : [];
      const loaded = models.filter((model) => model !== null && typeof model === 'object' && model.state === 'loaded');
      const embeddings = loaded
        .filter((model) => model.type === 'embeddings')
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      // What else LM Studio holds in memory — only needed to explain the problem.
      const others = loaded.filter((model) => model.type !== 'embeddings');
      const failed = state.phase === 'error';
      // The Host not knowing the route means the running Host predates the route:
      // a plugin reload brings the browser half, but the Host module stays cached.
      const routeMissing = failed && state.reason === 'route';
      const missingEmbedding = !failed && state.phase === 'ready' && embeddings.length === 0;
      const problem = failed || missingEmbedding;

      const accent = problem ? 'var(--dsw-alias-state-error-primary)' : null;
      const headStyle = problem
        ? { ...S.head, background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)' }
        : S.head;
      const counter = routeMissing
        ? 'нет маршрута'
        : failed
        ? 'нет связи'
        : missingEmbedding
        ? 'нет эмбеддинга'
        : state.phase === 'ready'
        ? `${embeddings.length} ${plural(embeddings.length, 'эмбеддинг', 'эмбеддинга', 'эмбеддингов')}`
        : '…';

      // Why there is no embedding: nothing at all is loaded, or the wrong kind is.
      const missingNote = missingEmbedding
        ? others.length === 0
          ? `ничего не загружено · ${models.length} скачано`
          : `загружена LLM ${others.slice(0, 2).map((model) => model.id).join(', ')}${others.length > 2 ? '…' : ''}, а эмбеддинг-модели нет`
        : null;

      const url = state.data !== null && typeof state.data.url === 'string' ? state.data.url : 'http://127.0.0.1:1234';
      const detail = failed
        ? `LM Studio: ${state.error}\n${url}`
        : `LM Studio: ${embeddings.length} ${plural(embeddings.length, 'эмбеддинг', 'эмбеддинга', 'эмбеддингов')} загружено из ${models.length} моделей\n${url}`;

      return h('div', { style: S.models },
        h('div', { style: headStyle, title: detail },
          h('button', {
            type: 'button',
            style: { ...S.title, color: accent ?? 'var(--dsw-alias-label-primary)' },
            'data-section': 'models',
            'aria-expanded': closedSection ? 'false' : 'true',
            title: closedSection ? 'Развернуть «LM Studio»' : 'Свернуть «LM Studio»',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setClosedSection((previous) => !previous);
            },
          }, [
            h('span', { key: 'chevron', style: S.titleChevron, 'aria-hidden': true }, closedSection ? '▸' : '▾'),
            h('span', { key: 'label' }, 'LM Studio'),
          ]),
          h('span', { style: { ...S.counter, color: accent ?? 'var(--dsw-alias-label-secondary)' } }, counter),
        ),
        closedSection
          ? null
          : failed
          ? h('div', { key: 'failed', style: S.note, title: url },
            routeMissing
              ? `${state.error}\nмаршрут api/lmstudio не зарегистрирован — приложение запущено со старым Host, нужен полный перезапуск (Cmd+Q)`
              : state.error)
          : missingEmbedding
          ? h('div', { key: 'missing', style: S.note, title: detail }, missingNote)
          : embeddings.length === 0
          ? h('div', { key: 'empty', style: S.note }, 'читаю список моделей…')
          : h('div', { key: 'list', style: S.list }, embeddings.map((model) => {
            const name = typeof model.id === 'string' && model.id !== '' ? model.id : '(без имени)';
            const meta = modelMeta(model);
            const rowDetail = [
              name,
              `тип: ${model.type ?? '—'}`,
              model.publisher ? `издатель: ${model.publisher}` : null,
              model.quantization ? `квантование: ${model.quantization}` : null,
              contextLabel(model.loadedContext ?? model.maxContext) ? `контекст: ${contextLabel(model.loadedContext ?? model.maxContext)}` : null,
            ].filter(Boolean).join('\n');
            return h('div', { key: name, style: S.row, title: rowDetail },
              h('span', { style: S.name }, name),
              meta === '' ? null : h('span', { style: S.meta }, meta),
            );
          })),
      );
    }

      return { component: ModelsPanel };
    })();

    // ── page: servers, containers and the three seats ─────────────────────────
    const DockerPage = (() => {

    /** Document-relative Host routes, so the browser resolves them under its own mount. */
    const ROUTE = 'api/mcp-docker-status';
    const ACTION_ROUTE = 'api/mcp-docker-status/action';
    /** This implementation's identity in the tab system, and the key its body registers under. */
    const TAB_ID = '@local/mcp-docker-status';
    /** The page kind the guide entry opens. */
    const TAB_KIND = 'mcp-docker-status';
    const TAB_TITLE = 'MCP-серверы';
    const TAB_DESCRIPTION = 'Состояние контейнеров и управление локальными MCP-серверами';
    /** The seat this page declares at its top, for another bundle to fill. */
    const TOP_SEAT = 'mcp-docker-status.top';
    /** The seat between the catalogue and the container rows: the loaded models. */
    const MIDDLE_SEAT = 'mcp-docker-status.middle';
    /** The seat below the rows, for a bundle that belongs after them. */
    const BOTTOM_SEAT = 'mcp-docker-status.bottom';
    const POLL_MS = 5000;
    /** Distance between a row and its bubble, and the bubble's viewport inset. */
    const GAP = 6;
    /** How long a destructive control stays armed, matching the host's own kill gesture. */
    const ARM_MS = 3000;
    /** How long an action result stays in the header. */
    const NOTICE_MS = 120000;

    /**
     * Component-local styles. Rendered as an element, so unmounting removes them;
     * the class prefix keeps them out of every other plugin's namespace.
     */
    const CSS = [
      '.mcpds-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.mcpds-row:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.mcpds-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;flex:none}',
      '.mcpds-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.mcpds-action:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.mcpds-action:disabled{opacity:.28;cursor:default}',
      '.mcpds-action[data-armed="true"],.mcpds-action[data-armed="true"]:hover{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base)}',
    ].join('');

    /** Status tones mapped onto theme tokens. */
    const TONE = {
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      bad: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    };

    /** Docker tone: healthy > running > down > absent. */
    function containerTone(target) {
      if (target.state === 'missing' || target.state === 'unknown') return 'idle';
      if (target.state !== 'running') return 'bad';
      if (target.health === 'unhealthy') return 'bad';
      if (target.health === 'healthy') return 'ok';
      return 'warn';
    }

    /**
     * A row's identity. A native MCP server has no container, so its row is keyed
     * by the server name; everything — keys and the hover target — goes through
     * here, because `container` alone collides for such rows.
     */
    function rowKey(target) {
      if (typeof target.container === 'string' && target.container !== '') return target.container;
      if (typeof target.server === 'string' && target.server !== '') return target.server;
      return 'row:' + (typeof target.label === 'string' ? target.label : 'unknown');
    }

    /**
     * Session-link tone: red while the server is up but not linked to this
     * session. A container row reads that from Docker; a native server has no
     * container, so its own endpoint probe decides.
     */
    function linkTone(target) {
      if (target.connected) return 'ok';
      if (target.hasContainer === false) return target.endpointOpen === true ? 'bad' : 'idle';
      const docker = containerTone(target);
      return docker === 'ok' || docker === 'warn' ? 'bad' : 'idle';
    }

    /** How long a native server's data may stand before its row calls it stale. */
    const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

    /** The full timestamp of the last data change, or an empty string. */
    function fullStamp(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }

    /**
     * How long ago a native server's data last changed: today, yesterday or the
     * day before name the day, anything older is a date. The clock time always
     * rides along, so "yesterday" is never ambiguous.
     */
    function formatLastUpdate(iso) {
      if (typeof iso !== 'string' || iso === '') return '';
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const midnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
      if (days <= 0) return `сегодня ${time}`;
      if (days === 1) return `вчера ${time}`;
      if (days === 2) return `позавчера ${time}`;
      const date = `${pad(at.getDate())}.${pad(at.getMonth() + 1)}`;
      return at.getFullYear() === new Date().getFullYear()
        ? `${date} ${time}`
        : `${date}.${String(at.getFullYear()).slice(2)} ${time}`;
    }

    /** Data-age tone: red once the store has stood for more than three days. */
    function freshnessTone(target) {
      if (typeof target.lastUpdate !== 'string' || target.lastUpdate === '') return 'idle';
      const at = new Date(target.lastUpdate).getTime();
      if (!Number.isFinite(at)) return 'idle';
      return Date.now() - at > STALE_AFTER_MS ? 'bad' : 'ok';
    }

    /** The container's own state and health, without the raw Docker status line. */
    function containerValue(target) {
      const parts = [target.state];
      if (target.health !== undefined && target.health !== 'none') parts.push(target.health);
      return parts.filter((part) => part !== undefined && part !== '').join(' · ');
    }

    /** Whether the MCP server is linked, and how many tools it contributed. */
    function linkValue(target) {
      return target.connected
        ? `linked · ${target.toolCount} mcp tool(s)`
        : 'not linked · no mcp tools registered';
    }

    /** The probed endpoint, or null when no probe ran. */
    function endpointValue(target) {
      if (target.endpointPort === null || target.endpointPort === undefined) return null;
      const open = target.endpointOpen === true ? 'open' : target.endpointOpen === false ? 'closed' : 'unknown';
      return `${target.endpointHost}:${target.endpointPort} ${open}`;
    }

    /** The bubble's label/value pairs for one row, with empty values dropped. */
    function detailRows(target) {
      const rows = [];
      // A native MCP server has no container, so it has nothing to report there.
      if (target.hasContainer !== false) {
        rows.push(['container', target.container]);
        rows.push(['state', containerValue(target)]);
        rows.push(['docker', target.status === 'not created' ? '' : target.status]);
      }
      if (target.hasServer) rows.push(['session', linkValue(target)]);
      if (target.hasContainer === false) rows.push(['updated', fullStamp(target.lastUpdate)]);
      rows.push(['endpoint', endpointValue(target)]);
      if (target.hasContainer !== false) rows.push(['image', target.image === null || target.image === undefined ? '' : target.image]);
      return rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
    }

    /** A row label that still reads when an older Host payload omits it. */
    function rowLabel(target) {
      if (typeof target.label === 'string' && target.label !== '') return target.label;
      if (typeof target.server === 'string' && target.server !== '') return target.server;
      return typeof target.container === 'string' ? target.container : 'unknown';
    }

    /** A group name that still reads when an older Host payload omits it. */
    function rowGroup(target) {
      return typeof target.group === 'string' && target.group !== '' ? target.group : 'containers';
    }

    /** Glyphs drawn inline: the plugin imports no artwork package. */
    function IconStart() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('path', { d: 'M5.2 3.4 12.2 8l-7 4.6z', fill: 'currentColor' }));
    }
    function IconStop() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5, fill: 'currentColor' }));
    }
    function IconRestart() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M13.4 1.8v3.4h-3.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    /** Styles: theme tokens only, so a renamed token degrades but never breaks. */
    const S = {
      root: {
        position: 'relative',
        height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        font: 'inherit', fontSize: 13, lineHeight: 1.5,
      },
      header: {
        flex: 'none', display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderBottom: '0.5px solid var(--dsw-alias-border-l1)',
      },
      headerText: { minWidth: 0, flex: 'auto', display: 'flex', flexDirection: 'column', gap: 1 },
      title: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 600 },
      summary: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      sub: (tone) => ({
        color: tone === null ? 'var(--dsw-alias-label-tertiary)' : TONE[tone], fontSize: 11,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }),
      refresh: {
        flex: 'none', width: 24, height: 24, padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', font: 'inherit',
      },
      // Sized by its rows, not by the panel: `flex: auto` here stretched the list to
      // the whole leftover height, which left a tall empty band between the server
      // rows and the seat below them. It still shrinks and scrolls when the column
      // is too short for every row.
      list: { flex: '0 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 6px 4px' },
      // A group heading is a disclosure band: the same shape the session days use.
      group: {
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
        padding: '3px 6px', margin: '6px 0 0', border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'var(--dsw-alias-bg-layer-2)',
        cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', font: 'inherit',
        fontSize: 11, fontWeight: 600, letterSpacing: '0', textAlign: 'left',
      },
      /** The chevron of a group heading. */
      groupChevron: { flex: 'none', width: 10, fontSize: 9, color: 'var(--dsw-alias-label-secondary)' },
      /** How many rows a group holds: a chip at the right edge. */
      groupCount: {
        flex: 'none', marginLeft: 'auto', padding: '0 5px', borderRadius: 999,
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)',
        font: '10px/14px var(--dsw-font-family-code)', textAlign: 'center', fontWeight: 400,
      },
      row: {
        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
        cursor: 'default', borderRadius: 'var(--dsw-radius-sm, 6px)',
      },
      dots: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, width: 20 },
      dot: (tone) => ({
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: TONE[tone] ?? TONE.idle,
      }),
      name: { minWidth: 0, flex: 'auto', color: 'var(--dsw-alias-label-primary)', fontSize: 12, overflowWrap: 'anywhere' },
      actions: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 1 },
      busy: { flex: 'none', width: 66, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
      /** How long ago a native server's data changed. */
      freshness: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, whiteSpace: 'nowrap' },
      empty: { padding: '12px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 },
      // The seat below the rows owns the leftover height: the row list keeps its own
      // size, and whatever is left belongs to the seat instead of being reserved as
      // an empty band between the two.
      // Basis 0 on purpose: the seat must claim only the space that is left after the
      // rows, never its own content height — otherwise a long session list would
      // squeeze the server rows it sits under.
      bottomSeat: { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' },
      bubble: (top) => ({
        position: 'absolute', top, left: 8, right: 8, zIndex: 20,
        pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', gap: 3,
        padding: '8px 10px', borderRadius: 'var(--dsw-radius-md, 8px)',
        background: 'var(--dsw-alias-bg-overlay)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.24))',
        color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: 1.45,
      }),
      bubbleRow: { display: 'flex', gap: 8, alignItems: 'baseline' },
      bubbleKey: { flex: 'none', width: 66, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
      bubbleValue: { minWidth: 0, flex: 'auto', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' },
    };

    /**
     * Poll the Host route while the tab is visible, restarting on refresh.
     * @param sessionId - the Session whose tab is showing.
     * @param active - whether the body is on screen.
     * @returns the latest state and a refresh action.
     */
    function useSnapshot(sessionId, active) {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null });
      const [generation, setGeneration] = React.useState(0);
      // The Host declares the interval; a change reaches the next scheduled poll.
      const intervalRef = React.useRef(POLL_MS);

      React.useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        let timer = null;
        const tick = async () => {
          try {
            const query = sessionId === undefined || sessionId === null
              ? ''
              : `?${new URLSearchParams({ sessionId: String(sessionId) }).toString()}`;
            const response = await fetch(`${ROUTE}${query}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (typeof data.pollMs === 'number' && data.pollMs >= 1000) intervalRef.current = data.pollMs;
            if (!cancelled) setState({ phase: 'ready', data, error: null });
          } catch (error) {
            if (!cancelled) {
              setState((previous) => ({
                phase: 'error',
                data: previous.data,
                error: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            if (!cancelled) timer = setTimeout(tick, intervalRef.current);
          }
        };
        tick();
        return () => {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
        };
      }, [sessionId, generation, active]);

      return { state, refresh: () => setGeneration((value) => value + 1) };
    }

    /** The right-sidebar page body: the declared top seat, a summary header, and grouped rows. */
    function StatusBody(props) {
      const { sessionId, useTabInfo, renderSlot } = props;
      const tabInfo = typeof useTabInfo === 'function' ? useTabInfo() : undefined;
      // Background Sessions and collapsed surfaces keep their bodies out of sight.
      const visible = tabInfo === undefined || tabInfo.tab === undefined || tabInfo.tab.visible !== false;
      const { state, refresh } = useSnapshot(sessionId, visible);

      const panelRef = React.useRef(null);
      const bubbleRef = React.useRef(null);
      const armTimer = React.useRef(null);
      const laterTimer = React.useRef(null);
      const alive = React.useRef(true);
      const [hover, setHover] = React.useState(null);
      // Which group headings the reader closed, by their text. A reading aid, so it
      // lives with the panel rather than in a setting.
      const [collapsed, setCollapsed] = usePanelSet('groups');
      const [bubbleHeight, setBubbleHeight] = React.useState(0);
      const [armed, setArmed] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [notice, setNotice] = React.useState(null);

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
          if (armTimer.current !== null) clearTimeout(armTimer.current);
          if (laterTimer.current !== null) clearTimeout(laterTimer.current);
        };
      }, []);

      React.useEffect(() => {
        if (notice === null) return undefined;
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
      }, [notice]);

      const data = state.data;
      const summary = data !== null && data !== undefined && data.summary !== undefined ? data.summary : null;
      const targets = data !== null && data !== undefined && Array.isArray(data.targets) ? data.targets : [];
      const actionsEnabled = data === null || data === undefined || data.actions !== false;
      // One press acts. Only a Host that sets confirmActions asks for a second.
      const confirmRequired = data !== null && data !== undefined && data.confirm === true;

      // Measure the bubble after it renders so a row near the bottom flips it above.
      React.useLayoutEffect(() => {
        if (hover === null) return;
        const element = bubbleRef.current;
        const measured = element === null ? 0 : element.offsetHeight;
        if (measured !== bubbleHeight) setBubbleHeight(measured);
      }, [hover, bubbleHeight]);

      /** Anchor the bubble to a row, in the panel's own coordinate space. */
      const show = (target) => (event) => {
        const panel = panelRef.current;
        if (panel === null || event === undefined || event.currentTarget === null) return;
        const panelRect = panel.getBoundingClientRect();
        const rowRect = event.currentTarget.getBoundingClientRect();
        setHover({
          key: rowKey(target),
          rowTop: rowRect.top - panelRect.top,
          rowHeight: rowRect.height,
          panelHeight: panelRect.height,
        });
      };
      const hide = () => setHover(null);

      /** Run one container action, then refresh so the dots catch up. */
      const perform = async (target, action) => {
        setBusy(target.container);
        setNotice(null);
        try {
          const response = await fetch(ACTION_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ container: target.container, action }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload === null || payload.ok !== true) {
            throw new Error(payload !== null && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
          }
          if (alive.current) setNotice(`${action} ${target.label}: done`);
        } catch (error) {
          if (alive.current) setNotice(`${action} ${target.label}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (alive.current) {
            setBusy(null);
            refresh();
            // A stop or a restart takes a moment to settle; read once more.
            if (laterTimer.current !== null) clearTimeout(laterTimer.current);
            laterTimer.current = setTimeout(() => { if (alive.current) refresh(); }, 2500);
          }
        }
      };

      /** Stop and restart ask twice only when the Host asked for confirmation. */
      const requestAction = (target, action) => {
        if (confirmRequired && action !== 'start') {
          const isArmed = armed !== null && armed.container === target.container && armed.action === action;
          if (!isArmed) {
            if (armTimer.current !== null) clearTimeout(armTimer.current);
            setNotice(null);
            setArmed({ container: target.container, action });
            armTimer.current = setTimeout(() => {
              armTimer.current = null;
              if (alive.current) setArmed(null);
            }, ARM_MS);
            return;
          }
        }
        if (armTimer.current !== null) {
          clearTimeout(armTimer.current);
          armTimer.current = null;
        }
        setArmed(null);
        void perform(target, action);
      };

      const headline = summary === null
        ? (state.phase === 'error' ? 'unavailable' : 'checking…')
        : `${summary.running}/${summary.total} running · ${summary.connected}/${summary.mcpTotal} linked` +
          (summary.reachable !== summary.probeTotal ? ` · ${summary.reachable}/${summary.probeTotal} port open` : '');

      const dockerProblem = data !== null && data !== undefined && data.docker !== undefined && data.docker.ok === false
        ? data.docker.error
        : null;
      const problem = state.phase === 'error' ? state.error : dockerProblem;
      const updated = data !== null && data !== undefined && typeof data.generatedAt === 'string'
        ? new Date(data.generatedAt).toLocaleTimeString()
        : null;

      const subtitle = notice !== null
        ? notice
        : problem !== null && problem !== undefined
          ? problem
          : updated === null ? 'waiting for the host' : `updated ${updated}`;
      const subtitleTone = notice !== null ? 'warn' : (problem !== null && problem !== undefined ? 'bad' : null);

      /** One control; `start` acts at once, the others need a confirming second press. */
      const actionButton = (target, action, Icon, title) => {
        const running = target.state === 'running';
        const disabled = busy !== null || (action === 'start' ? running : !running);
        const isArmed = armed !== null && armed.container === target.container && armed.action === action;
        return h('button', {
          key: action,
          type: 'button',
          className: 'mcpds-action',
          disabled,
          'data-armed': isArmed ? 'true' : undefined,
          title: isArmed ? `${title} ${target.label} — press again to confirm` : `${title} ${target.label}`,
          'aria-label': `${title} ${target.container}`,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            requestAction(target, action);
          },
        }, h(Icon));
      };

      const rowFor = (target) => {
        const native = target.hasContainer === false;
        const stamp = native ? formatLastUpdate(target.lastUpdate) : '';
        return h('div', {
          key: `entry:${rowKey(target)}`,
        },
          h('div', {
            className: 'mcpds-row',
            style: S.row,
            tabIndex: 0,
            onMouseEnter: show(target),
            onMouseLeave: hide,
            onFocus: show(target),
            onBlur: hide,
          },
            h('span', { style: S.dots },
              // A container row reports its container state first; a native server
              // has no container, so its first dot reports how old its data is.
              h('span', { style: S.dot(native ? freshnessTone(target) : containerTone(target)) }),
              target.hasServer ? h('span', { style: S.dot(linkTone(target)) }) : null,
            ),
            h('span', { style: S.name }, rowLabel(target)),
            native
              ? (stamp === '' ? null : h('span', { style: S.freshness, title: `обновлено ${fullStamp(target.lastUpdate)}` }, stamp))
              : !actionsEnabled ? null : busy === target.container
                ? h('span', { style: S.busy }, 'applying…')
                : h('span', { style: S.actions },
                  actionButton(target, 'start', IconStart, 'Start'),
                  actionButton(target, 'stop', IconStop, 'Stop'),
                  actionButton(target, 'restart', IconRestart, 'Restart'),
                ),
          ),
        );
      };

      const nodes = [];
      const collapsedGroups = collapsed;
      let lastGroup = null;
      for (const target of targets) {
        const group = rowGroup(target);
        if (group !== lastGroup) {
          lastGroup = group;
          const count = targets.filter((item) => rowGroup(item) === group).length;
          nodes.push(h('button', {
            key: `group:${group}`,
            type: 'button',
            style: S.group,
            'data-group': group,
            'aria-expanded': collapsedGroups.has(group) ? 'false' : 'true',
            title: collapsedGroups.has(group) ? `Развернуть «${group}»` : `Свернуть «${group}»`,
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              });
            },
          }, [
            h('span', { key: 'chevron', style: S.groupChevron, 'aria-hidden': true }, collapsedGroups.has(group) ? '▸' : '▾'),
            h('span', { key: 'label' }, group),
            h('span', { key: 'count', style: S.groupCount }, String(count)),
          ]));
        }
        // A closed group keeps its heading — with the row count — and nothing else.
        if (collapsedGroups.has(group)) continue;
        nodes.push(rowFor(target));
      }

      const hovered = hover === null ? undefined : targets.find((target) => rowKey(target) === hover.key);
      let bubble = null;
      if (hover !== null && hovered !== undefined) {
        const below = hover.rowTop + hover.rowHeight + GAP;
        const fitsBelow = below + bubbleHeight <= hover.panelHeight - GAP;
        const above = hover.rowTop - bubbleHeight - GAP;
        const top = fitsBelow ? below : Math.max(GAP, above >= GAP ? above : hover.panelHeight - bubbleHeight - GAP);
        bubble = h('div', { ref: bubbleRef, style: S.bubble(top), role: 'tooltip' },
          detailRows(hovered).map(([key, value]) => h('div', { key, style: S.bubbleRow },
            h('span', { style: S.bubbleKey }, key),
            h('span', { style: S.bubbleValue }, value),
          )),
        );
      }

      return h('div', { ref: panelRef, style: S.root },
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { style: S.header },
          h('div', { style: S.headerText },
            h('div', { style: S.title }, TAB_TITLE),
            h('div', { style: S.summary }, headline),
            h('div', { style: S.sub(subtitleTone), title: subtitle }, subtitle),
          ),
          h('button', {
            type: 'button', style: S.refresh, title: `Refresh now — ${subtitle}`,
            'aria-label': 'Refresh now', onClick: () => refresh(),
          }, '⟳'),
        ),
        // The declared seat: whatever another bundle contributes sits here, above
        // every container row but below this page's own title.
        typeof renderSlot === 'function' ? renderSlot(TOP_SEAT, { visible }) : null,
        // Between the catalogue and the rows: the models LM Studio has loaded.
        typeof renderSlot === 'function' ? renderSlot(MIDDLE_SEAT, { visible }) : null,
        h('div', { style: S.list }, targets.length === 0
          ? h('div', { style: S.empty }, state.phase === 'error' ? 'Нет данных от хоста.' : 'Ни один сервер не отслеживается.')
          : nodes),
        // The seat under the rows sits at the foot of the page: the rows keep their
        // own height and the leftover space collects between them, so the session
        // list is where the eye ends up instead of floating after the last row.
        typeof renderSlot === 'function'
          ? h('div', { key: 'bottom', style: S.bottomSeat }, renderSlot(BOTTOM_SEAT, { visible }))
          : null,
        bubble,
      );
    }

      return { component: StatusBody };
    })();

    /** The page the sidebar shows, with its three seats filled by the sections above. */
    // The sidebar remembers the open tab per Session by `kind`/`id`, so both the
    // pre-merge pair and the merged one must resolve to this page: otherwise a
    // Session that remembered the other pair shows "nothing can view this kind".
    // The pair the merged page keeps from the server page it grew out of: the
    // sidebar remembers the open tab per Session by `kind`/`id`, so keeping them
    // means a Session that remembered the pre-merge page lands on this one.
    const TAB_ID = '@local/mcp-docker-status';
    const TAB_KIND = 'mcp-docker-status';
    const TAB_TITLE = 'Пульт';
    const TAB_DESCRIPTION = 'Контексты cfsmcp2, модели LM Studio, MCP-серверы и список сессий';
    // The names the page body renders its seats under (kept as they were, so a
    // bundle that filled them before still would).
    const TOP_SEAT = 'mcp-docker-status.top';
    const MIDDLE_SEAT = 'mcp-docker-status.middle';
    const BOTTOM_SEAT = 'mcp-docker-status.bottom';

    const Page = (props) => h(DockerPage.component, { ...props, useSessions: props.useSessions });

    return {
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace'],
      apply(ctx) {
        // A failed registration must never take the whole boot down: the bundle is
        // one entry, and an entry that throws is reported as "did not activate".
        try {
          activate(ctx);
        } catch (error) {
          try {
            console.error('[dsh-pult] activation failed', error);
            void fetch('api/dsh-pult/diag', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ fatal: error instanceof Error ? error.message : String(error), version: 2 }),
            });
          } catch {
            // Nothing left to report to.
          }
        }
      },
    };

    /** Register the page, its three seats and its tab type; every step is guarded. */
    function activate(ctx) {
        // The session rows reveal and create Sessions through the workspace service.
        bridge.uiWorkspace = ctx.uiWorkspace;
        bridge.sidebarRight = ctx.sidebarRight;
        bridge.sidebarRightTabs = ctx.sidebarRightTabs;

        // Every registration below is guarded on purpose. One refused registration
        // must not fail the whole bundle: the boot reports a failed entry and takes
        // the entire page down with it, while a logged miss leaves the rest working.
        /** What this activation managed, reported to the Host for diagnosis. */
        const report = { registered: [], failed: [] };
        const sendReport = () => {
          try {
            void fetch('api/dsh-pult/diag', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                registered: report.registered,
                failed: report.failed,
                panes: typeof document === 'undefined' ? 'no-document' : document.readyState,
                version: 2,
              }),
            });
          } catch {
            // Diagnosis must never break the panel.
          }
        };

        /** Run one registration, reporting a refusal without failing the bundle. */
        const guard = (label, run) => {
          try {
            const value = run();
            report.registered.push(label);
            return value;
          } catch (error) {
            try {
              console.error(`[dsh-pult] ${label}`, error);
            } catch {
              // Nothing left to report to.
            }
            report.failed.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }
        };

        guard('styles', () => ctx.effect(() => SessionsSection.installStyles(), 'dsh-pult: session styles'));

        guard('tab type', () => ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => TAB_TITLE,
          guide: [{
            id: TAB_KIND,
            order: 40,
            title: () => TAB_TITLE,
            description: () => TAB_DESCRIPTION,
          }],
        }), 'dsh-pult: sidebar tab type'));

        guard('page', () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          // The page declares its seats; this same bundle fills them below.
          children: {
            [TOP_SEAT]: { kind: 'list', scope: 'session' },
            [MIDDLE_SEAT]: { kind: 'list', scope: 'session' },
            [BOTTOM_SEAT]: { kind: 'list', scope: 'session' },
          },
        }, Page)));

        guard('catalogue seat', () => ctx.slots.inject(TOP_SEAT, () => ctx.slots.register({
          name: TOP_SEAT,
          id: TAB_ID + ':catalogue',
          order: 10,
        }, CatalogueSection.component)));

        guard('models seat', () => ctx.slots.inject(MIDDLE_SEAT, () => ctx.slots.register({
          name: MIDDLE_SEAT,
          id: TAB_ID + ':models',
          order: 15,
        }, ModelsSection.component)));

        guard('sessions seat', () => ctx.slots.inject(BOTTOM_SEAT, () => ctx.slots.register({
          name: BOTTOM_SEAT,
          id: TAB_ID + ':sessions',
          order: 20,
        }, SessionsSection.component)));

        // Put the page where the user expects it: the column it belongs to is
        // expanded once per Session, so the list is visible without hunting the
        // guide. The surface can be unminted while the on-screen Session changes,
        // so a refused attempt is retried a bounded number of times.
        guard('auto-open', () => ctx.effect(() => {
          const opened = new Set();
          let timer = null;

          function schedule(delay, tries) {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              attempt(tries);
            }, delay);
          }

          function attempt(tries) {
            try {
              const mounted = ctx.sidebarRight.mounted;
              const session = mounted !== undefined && mounted !== null && typeof mounted.getSnapshot === 'function'
                ? mounted.getSnapshot()
                : undefined;
              if (session === undefined || session === null || opened.has(session)) return;
              opened.add(session);
              const done = ctx.sidebarRight.openTab({ kind: TAB_KIND, id: TAB_ID });
              if (done === false && tries > 0) schedule(250, tries - 1);
            } catch {
              if (tries > 0) schedule(250, tries - 1);
            }
          }

          schedule(120, 8);
          return () => {
            if (timer !== null) clearTimeout(timer);
          };
        }, 'dsh-pult: open the page once per session'));

        sendReport();
    }
  },
});
