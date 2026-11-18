// The action menu. It runs as an extension page, either in a frame over the Jira tab (mode=overlay)
// or as a small popup window (mode=window). All Jira work happens in the service worker, which
// runs it inside the tab given by ?tab=.

const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tab'));
const mode = params.get('mode') === 'window' ? 'window' : 'overlay';
document.body.classList.add(mode);

const $ = (id) => document.getElementById(id);
const EXACT_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ICON = {
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  md: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6M17 9v6M15 13l2 2 2-2"/>',
  url: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M18 8c0 6-8 4-11.5 9"/>',
  pr: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8M18 16v-6a3 3 0 0 0-3-3h-4"/><path d="M13 5l-2 2 2 2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  tabs: '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v11"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};

let ctx = null;           // from the service worker: key, ticket previews, search, selection keys
let shortcuts = {};       // command name -> shortcut text
let level = 'root';       // 'root' | 'branch' | 'pr'
let active = 0;
let moved = false;        // the user moved the selection since the list last changed
let flat = [];
let branches = null;
let prs = null;
let picker = { query: '', items: [], loading: false };
let pickerTimer;
let busy = false;

const send = (type, data = {}) => chrome.runtime.sendMessage({ type, tabId, ...data });

init();

async function init() {
  wireEvents();
  render();
  focusInput();
  const [context, commands] = await Promise.all([
    send('menu:context').catch((err) => ({ ok: false, error: err.message })),
    chrome.commands.getAll().catch(() => []),
  ]);
  ctx = context;
  shortcuts = Object.fromEntries(commands.map((c) => [c.name, c.shortcut]));
  const start = params.get('level');
  if (start === 'pr' || start === 'branch') enterLevel(start);
  else render();
}

function focusInput() {
  window.focus();
  $('q').focus({ preventScroll: true });
}

// ---------- Running actions ----------

async function run(action, args = {}) {
  if (busy) return;
  busy = true;
  try {
    await send('menu:run', { action, args });
  } finally {
    close();
  }
}

function close() {
  if (mode === 'window') window.close();
  else window.parent.postMessage('ticket-kit:close', '*');
}

// ---------- Models: what each level lists ----------

function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }
function matches(hay, toks) { const h = hay.toLowerCase(); return toks.every((t) => h.includes(t)); }

function rootModel(q) {
  if (!ctx) return [{ title: '', items: [], note: 'Loading…' }];
  if (!ctx.ok) return [{ title: '', items: [], note: ctx.error ?? 'Could not read this tab.', err: true }];

  const query = q.trim();
  const toks = tokens(query);
  const key = EXACT_KEY.test(query) ? query.toUpperCase() : null;
  const filter = (items) => (key ? [] : items.filter((it) => !toks.length || matches(`${it.title} ${it.keys ?? ''}`, toks)));
  const groups = [];

  if (key) {
    groups.push({ title: 'Open ticket', items: [{ icon: 'open', title: `Open ${key}`, sub: 'In a new tab', run: () => run('open-keys', { keys: [key] }) }] });
  }
  if (!query && ctx.selectionKeys?.length) {
    const items = ctx.selectionKeys.slice(0, 3).map((k) => ({
      icon: 'open', title: `Open ${k}`, sub: 'Found in the text you selected', run: () => run('open-keys', { keys: [k] }),
    }));
    if (ctx.selectionKeys.length > 1) {
      items.push({ icon: 'search', title: `Open all ${ctx.selectionKeys.length} in one search`, sub: ctx.selectionKeys.join(', '),
        run: () => run('open-keys', { keys: ctx.selectionKeys }) });
    }
    groups.push({ title: 'From your selection', items });
  }
  if (ctx.ticket) groups.push({ title: `Ticket ${ctx.key}`, items: filter(ticketItems()) });
  if (ctx.search) groups.push({ title: 'This search', items: filter(searchItems()) });

  if (!key && query.length >= 2) {
    const items = picker.query === query
      ? picker.items.map((t) => ({ icon: 'open', title: t.summary || t.key, sub: t.key, hl: true, run: () => run('open-keys', { keys: [t.key] }) }))
      : [];
    items.push({ icon: 'search', title: `Search Jira for "${query}"`, sub: 'Opens Jira search in a new tab', run: () => run('search-text', { text: query }) });
    groups.push({ title: 'Tickets', items, note: picker.loading && picker.query === query ? 'Searching Jira…' : null });
  }
  groups.push({ title: 'General', items: filter(generalItems(query)) });
  return groups;
}

function ticketItems() {
  const t = ctx.ticket;
  return [
    { icon: 'link', title: 'Copy link', sub: t.link, kbd: shortcuts['copy-link'], keys: 'copy link rich html', run: () => run('copy-link') },
    { icon: 'md', title: 'Copy as Markdown', sub: t.markdown, subMono: true, keys: 'copy markdown md', run: () => run('copy-markdown') },
    { icon: 'url', title: 'Copy URL', sub: t.url, subMono: true, keys: 'copy url address', run: () => run('copy-url') },
    { icon: 'branch', title: 'Copy branch name', sub: t.branch, subMono: true, kbd: shortcuts['copy-branch'], keys: 'copy branch git switch checkout', submenu: 'branch' },
    { icon: 'pr', title: 'Open pull request', sub: 'Pull requests linked in Jira', kbd: shortcuts['open-pr'], keys: 'open pull request pr bitbucket review', submenu: 'pr' },
  ];
}

function searchItems() {
  return [
    { icon: 'list', title: 'Copy results as a list', sub: 'Up to 100 tickets as rich links, one per line', kbd: shortcuts['copy-list'],
      keys: 'copy results list search all tickets', run: () => run('copy-list', { format: 'list' }) },
    { icon: 'md', title: 'Copy results as Markdown', sub: '- [KEY - Summary](url), one per line', subMono: true,
      keys: 'copy results list markdown md', run: () => run('copy-list', { format: 'markdown' }) },
  ];
}

function generalItems(query) {
  const items = [];
  if (!query) {
    const project = ctx.key ? `${ctx.key.split('-')[0]}-` : '';
    items.push({ icon: 'open', title: 'Open a ticket…', sub: 'Type its key, like ABC-123', keys: 'open go ticket key',
      run: () => { $('q').value = project; onInput(); focusInput(); } });
  }
  items.push({ icon: 'gear', title: 'Options', sub: 'Link templates, branch prefixes, Jira site', keys: 'options settings',
    run: () => run('options') });
  return items;
}

function branchModel(q) {
  if (!branches) return [{ title: '', items: [], note: 'Reading branches from Jira…' }];
  if (!branches.ok) return [{ title: '', items: [], note: branches.error, err: true }];
  const toks = tokens(q);
  const keep = (name) => !toks.length || matches(name, toks);
  const fresh = branches.fresh.filter(keep).map((name, i) => ({
    icon: 'branch', title: name, mono: true, hl: true,
    sub: i === 0 && keep(branches.fresh[0]) ? `New branch, prefix from the issue type${branches.type ? ` (${branches.type})` : ''}` : 'New branch, other prefix',
    pill: i === 0 && keep(branches.fresh[0]) ? ['', 'Default'] : null,
    run: (o) => run('copy-branch', { name, git: Boolean(o?.alt), isNew: true }),
  }));
  const existing = branches.existing.filter((b) => keep(b.name)).map((b) => ({
    icon: 'branch', title: b.name, mono: true, hl: true, sub: b.repo ? `Exists in ${b.repo}` : 'Exists in Bitbucket',
    run: (o) => run('copy-branch', { name: b.name, git: Boolean(o?.alt), isNew: false }),
  }));
  return [
    { title: 'New branch', items: fresh },
    {
      title: 'Existing branches',
      items: existing,
      note: branches.existingError ? `Could not read existing branches. ${branches.existingError}`
        : (!branches.existing.length && !toks.length ? 'None linked in Jira yet.' : null),
    },
  ];
}

function prModel(q) {
  if (!prs) return [{ title: '', items: [], note: 'Reading pull requests from Jira…' }];
  if (!prs.ok) return [{ title: '', items: [], note: prs.error, err: true }];
  if (!prs.items.length) return [{ title: '', items: [], note: `No pull request linked to ${prs.key}.` }];
  const toks = tokens(q);
  const shown = prs.items.filter((p) => !toks.length || matches(`${p.id} ${p.name} ${p.source} ${p.dest} ${p.repo} ${p.status}`, toks));
  const groups = [['OPEN', 'Open'], ['MERGED', 'Merged'], ['DECLINED', 'Declined']].map(([status, label]) => ({ status, label }));
  const known = new Set(groups.map((g) => g.status));
  groups.push({ status: null, label: 'Other' });
  // Opens whatever the list shows, so typing "open" or a repo name first narrows what opens.
  // skip: Enter on a fresh list still opens the first pull request, not all of them.
  const openAll = shown.length >= 2 ? [{
    title: '',
    items: [{
      icon: 'tabs', title: `Open all ${shown.length} shown`, sub: 'Each in a new tab next to this one', kbd: '⇧↵',
      skip: true, openAll: true, run: () => run('open-urls', { urls: shown.map((p) => p.url) }),
    }],
  }] : [];
  return [...openAll, ...groups.map((g) => ({
    title: g.label,
    items: shown
      .filter((p) => (g.status ? p.status === g.status : !known.has(p.status)))
      .map((p) => ({
        icon: 'pr',
        title: `#${p.id}  ${p.name}`,
        hl: true,
        sub: `${p.source} → ${p.dest}${p.repo ? ` · ${p.repo}` : ''}${p.updated ? ` · ${formatDate(p.updated)}` : ''}`,
        subMono: true,
        pill: [String(p.status).toLowerCase(), p.status || 'Unknown'],
        run: () => run('open-url', { url: p.url }),
      })),
  }))];
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------- Rendering ----------

function highlight(text, toks) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  const ranges = toks.map((t) => [lower.indexOf(t), t]).filter(([i]) => i >= 0).map(([i, t]) => [i, i + t.length]);
  ranges.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [start, end] of ranges) {
    if (end <= pos) continue;
    const from = Math.max(start, pos);
    if (from > pos) frag.append(text.slice(pos, from));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(from, end);
    frag.append(mark);
    pos = end;
  }
  frag.append(text.slice(pos));
  return frag;
}

function svg(name) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, v);
  el.innerHTML = ICON[name];
  return el;
}

function render() {
  const q = $('q').value;
  const groups = level === 'branch' ? branchModel(q) : level === 'pr' ? prModel(q) : rootModel(q);
  const toks = level === 'root' && EXACT_KEY.test(q.trim()) ? [] : tokens(q);
  const list = $('list');
  list.textContent = '';
  flat = [];

  for (const group of groups) {
    if (!group.items.length && !group.note) continue;
    if (group.title) {
      const h = document.createElement('div');
      h.className = 'grp';
      h.setAttribute('role', 'presentation');
      h.textContent = group.title;
      list.append(h);
    }
    for (const item of group.items) {
      const idx = flat.push(item) - 1;
      list.append(itemElement(item, idx, toks));
    }
    if (group.note) {
      const n = document.createElement('div');
      n.className = `note${group.err ? ' err' : ''}`;
      n.textContent = group.note;
      list.append(n);
    }
  }
  if (!flat.length && !list.childElementCount) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `Nothing matches "${q.trim()}". Try a ticket key, or fewer words.`;
    list.append(empty);
  }
  if (!moved) active = Math.max(0, flat.findIndex((item) => !item.skip));
  if (active >= flat.length) active = Math.max(0, flat.length - 1);
  renderChrome();
  markActive(true);
}

function itemElement(item, idx, toks) {
  const el = document.createElement('div');
  el.className = 'item';
  el.id = `opt-${idx}`;
  el.dataset.idx = String(idx);
  el.setAttribute('role', 'option');

  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.append(svg(item.icon));

  const main = document.createElement('span');
  main.className = 'main';
  const title = document.createElement('span');
  title.className = `title${item.mono ? ' mono' : ''}`;
  title.append(toks.length && (item.keys || item.hl) ? highlight(item.title, toks) : item.title);
  const sub = document.createElement('span');
  sub.className = `sub${item.subMono ? ' mono' : ''}`;
  sub.textContent = item.sub ?? '';
  main.append(title, sub);

  const right = document.createElement('span');
  right.className = 'right';
  if (item.pill) {
    const pill = document.createElement('span');
    pill.className = `pill ${item.pill[0]}`;
    pill.textContent = item.pill[1];
    right.append(pill);
  }
  if (item.kbd) {
    const kbd = document.createElement('kbd');
    kbd.textContent = item.kbd;
    right.append(kbd);
  }
  if (item.submenu) {
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '›';
    right.append(chev);
  }
  el.append(ico, main, right);
  el.addEventListener('mousemove', () => { if (active !== idx) { active = idx; moved = true; markActive(false); } });
  el.addEventListener('click', (e) => { active = idx; activate({ alt: e.altKey }); });
  return el;
}

function renderChrome() {
  const crumb = $('crumb');
  crumb.hidden = level === 'root';
  crumb.textContent = level === 'branch' ? 'Copy branch name' : level === 'pr' ? 'Open pull request' : '';
  $('q').placeholder = level === 'branch' ? 'Filter branches'
    : level === 'pr' ? 'Filter pull requests'
      : 'Type an action, a ticket key, or words to search Jira';

  const box = $('ctx');
  box.textContent = '';
  const chip = document.createElement('span');
  chip.className = 'chip';
  const txt = document.createElement('span');
  txt.className = 'txt';
  if (!ctx?.ok) {
    chip.textContent = 'Jira';
    txt.textContent = ctx ? 'This tab could not be read' : 'Reading the tab…';
  } else if (level === 'branch') {
    chip.textContent = ctx.key;
    txt.textContent = '⌥↵ copies a git switch command instead of the name';
  } else if (level === 'pr') {
    chip.textContent = ctx.key;
    txt.textContent = 'Pull requests from Jira\'s Development panel';
  } else if (ctx.ticket) {
    chip.textContent = ctx.key;
    txt.textContent = ctx.ticket.summary || 'Summary not available';
  } else if (ctx.search) {
    chip.textContent = 'Search';
    txt.textContent = ctx.search;
  } else {
    chip.textContent = ctx.host || 'This tab';
    txt.textContent = 'No Jira ticket in this tab';
  }
  box.append(chip, txt);

  const hints = level === 'root'
    ? [['↑↓', 'move'], ['↵', 'run'], ['→', 'more choices'], ['esc', 'close']]
    : level === 'branch'
      ? [['↵', 'copy name'], ['⌥↵', 'copy git command'], ['esc', 'back']]
      : [['↵', 'open in a new tab'], ['⇧↵', 'open all shown'], ['esc', 'back']];
  const foot = $('foot');
  foot.textContent = '';
  for (const [key, label] of hints) {
    const span = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    span.append(kbd, label);
    foot.append(span);
  }
}

function markActive(scroll) {
  const list = $('list');
  for (const el of list.querySelectorAll('.item')) el.setAttribute('aria-selected', String(Number(el.dataset.idx) === active));
  const el = document.getElementById(`opt-${active}`);
  $('q').setAttribute('aria-activedescendant', el ? el.id : '');
  if (scroll && el) {
    if (el.offsetTop < list.scrollTop + 4) list.scrollTop = el.offsetTop - 28;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 8;
    }
  }
}

// ---------- Navigation ----------

function activate(opts) {
  const item = flat[active];
  if (!item) return;
  if (item.submenu) enterLevel(item.submenu);
  else item.run(opts);
}

function enterLevel(next) {
  level = next;
  active = 0;
  moved = false;
  $('q').value = '';
  $('list').scrollTop = 0;
  render();
  focusInput();
  if (next === 'branch' && !branches) {
    send('menu:branches').then((r) => { branches = r; if (level === 'branch') render(); },
      (err) => { branches = { ok: false, error: err.message }; render(); });
  }
  if (next === 'pr' && !prs) {
    send('menu:prs').then((r) => { prs = r; if (level === 'pr') render(); },
      (err) => { prs = { ok: false, error: err.message }; render(); });
  }
}

function onInput() {
  active = 0;
  moved = false;
  const query = $('q').value.trim();
  if (level === 'root' && query.length >= 2 && !EXACT_KEY.test(query) && picker.query !== query) {
    picker = { query, items: [], loading: true };
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(async () => {
      const result = await send('menu:picker', { query }).catch(() => null);
      if (picker.query !== query) return;
      picker = { query, items: result?.ok ? result.items : [], loading: false };
      render();
    }, 200);
  }
  render();
}

function wireEvents() {
  $('q').addEventListener('input', onInput);
  // On the whole document, so Escape and the arrows work even after a click leaves the search box.
  document.addEventListener('keydown', (e) => {
    if (e.target !== $('q') && e.key.length === 1 && !e.metaKey && !e.ctrlKey) focusInput();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length) { active = (active + 1) % flat.length; moved = true; markActive(true); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) { active = (active - 1 + flat.length) % flat.length; moved = true; markActive(true); }
    } else if (e.key === 'Enter' && e.shiftKey && level === 'pr') {
      e.preventDefault();
      flat.find((item) => item.openAll)?.run();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate({ alt: e.altKey });
    } else if ((e.key === 'ArrowRight' || e.key === 'Tab') && flat[active]?.submenu) {
      e.preventDefault();
      enterLevel(flat[active].submenu);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (level !== 'root') enterLevel('root');
      else close();
    } else if (e.key === 'Backspace' && !$('q').value && level !== 'root') {
      e.preventDefault();
      enterLevel('root');
    }
  });
  // The page focuses the frame once it loads. Pass that focus on to the search box.
  window.addEventListener('focus', () => {
    if (document.activeElement !== $('q')) $('q').focus({ preventScroll: true });
  });
  $('crumb').addEventListener('click', () => enterLevel('root'));
  $('scrim').addEventListener('click', close);
  if (mode === 'window') window.addEventListener('blur', () => { if (!busy) close(); });
}
