// Both functions run inside the Jira tab through chrome.scripting.executeScript.
// Chrome serializes them with toString(), so they must not use imports or outer variables.

/**
 * Reads the ticket's summary, type, status and project.
 * First choice is Jira's REST API: a same-origin request from the tab carries the user's session cookie,
 * so no API token is needed. If that fails and the ticket is the one open in the tab, it falls back to
 * the tab title ("[PAY-1] Summary - Jira") and then to the summary heading.
 */
export async function readTicket(key, origin, isOpenTicket) {
  const empty = { key, id: null, summary: null, type: null, status: null, project: null, source: null };
  try {
    const res = await fetch(
      `${origin}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype,status,project`,
      { headers: { Accept: 'application/json' } },
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('json')) {
      const { id, fields } = await res.json();
      if (fields?.summary) {
        return {
          key,
          id: id ?? null,
          summary: fields.summary,
          type: fields.issuetype?.name ?? null,
          status: fields.status?.name ?? null,
          project: fields.project?.name ?? null,
          source: 'rest',
        };
      }
    }
  } catch {
    // Network error or a cross-origin link. Try the page below.
  }
  if (!isOpenTicket) return empty;

  const title = document.title.match(/^\[([A-Z][A-Z0-9_]+-\d+)\] (.+) - Jira$/);
  if (title && title[1] === key) return { ...empty, summary: title[2], source: 'title' };

  const heading = document.querySelector(
    'h1[data-testid="work.item.summary.heading"], h1[data-testid="issue.views.issue-base.foundation.summary.heading"]',
  );
  const text = heading?.textContent.trim();
  if (text) return { ...empty, summary: text, source: 'heading' };
  return empty;
}

/**
 * Shows a small notice at the bottom center of the page for 2.6 seconds.
 * It lives in a shadow root so Jira's styles can't change it, and the text is set with textContent.
 */
export function showToast(kind, title, detail) {
  const ID = 'ticket-kit-toast';
  document.getElementById(ID)?.remove();

  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; left: 50%; bottom: 24px;'
    + ' transform: translateX(-50%); pointer-events: none;';
  const root = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .toast {
      --bg: #1b2531; --fg: #eef2f7; --ok: #4fc58c; --warn: #e8b259; --err: #ff8a7a; --on: #0d1218;
      display: flex; align-items: center; gap: 10px; box-sizing: border-box;
      width: max-content; max-width: min(480px, calc(100vw - 32px));
      padding: 10px 16px 10px 12px; border-radius: 10px;
      background: var(--bg); color: var(--fg);
      box-shadow: 0 6px 22px rgba(10, 16, 26, .28);
      font: 13.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      .toast { --bg: #e8edf4; --fg: #141b24; --ok: #17794a; --warn: #8a5800; --err: #b5382a; --on: #ffffff; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .toast { animation: rise .25s ease-out; }
      @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
    }
    .icon {
      flex: none; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center;
      font-weight: 700; font-size: 12px; color: var(--on); background: var(--ok);
    }
    .warn .icon { background: var(--warn); }
    .err .icon { background: var(--err); }
    .text { min-width: 0; display: grid; gap: 1px; }
    .title { font-weight: 600; }
    .detail { font-size: 12.5px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `);
  root.adoptedStyleSheets = [sheet];

  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.setAttribute('role', 'status');
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = kind === 'ok' ? '✓' : '!';
  const text = document.createElement('span');
  text.className = 'text';
  const titleEl = document.createElement('span');
  titleEl.className = 'title';
  titleEl.textContent = title;
  text.append(titleEl);
  if (detail) {
    const detailEl = document.createElement('span');
    detailEl.className = 'detail';
    detailEl.textContent = detail;
    text.append(detailEl);
  }
  toast.append(icon, text);
  root.append(toast);
  document.documentElement.append(host);

  setTimeout(() => host.remove(), 2600);
}

/** The text selected in the page, capped at 2000 characters. */
export function readSelection() {
  return String(window.getSelection?.() ?? '').slice(0, 2000);
}

/**
 * Branches or pull requests linked to a ticket, as Jira's Development panel shows them.
 * dataType is 'branch' or 'pullrequest'. The dev-status endpoint is undocumented, so every
 * failure comes back as { ok: false, error } and never throws.
 */
export async function readDev(origin, key, dataType) {
  const get = async (path) => {
    const res = await fetch(origin + path, { headers: { Accept: 'application/json' } });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('json')) throw new Error(`Jira answered HTTP ${res.status}`);
    return res.json();
  };
  try {
    const issue = await get(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype`);
    const detail = await get(`/rest/dev-status/latest/issue/detail?issueId=${encodeURIComponent(issue.id)}`
      + `&applicationType=bitbucket&dataType=${dataType}`);
    const entries = Array.isArray(detail.detail) ? detail.detail : [];
    const base = { ok: true, summary: issue.fields?.summary ?? '', type: issue.fields?.issuetype?.name ?? '' };
    if (dataType === 'pullrequest') {
      return {
        ...base,
        items: entries.flatMap((d) => d.pullRequests ?? []).map((p) => ({
          id: String(p.id ?? ''),
          name: p.name ?? '',
          status: p.status ?? '',
          url: p.url ?? '',
          source: p.source?.branch ?? '',
          dest: p.destination?.branch ?? '',
          repo: p.repositoryName ?? '',
          updated: p.lastUpdate ?? '',
        })),
      };
    }
    return {
      ...base,
      items: entries.flatMap((d) => d.branches ?? []).map((b) => ({
        name: b.name ?? '',
        repo: b.repository?.name ?? '',
      })),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Runs a search the way the page shows it. query is { jql } or { filterId }.
 * Returns up to `max` tickets, and more: true when Jira has further pages.
 */
export async function runSearch(origin, query, max) {
  const get = async (path) => {
    const res = await fetch(origin + path, { headers: { Accept: 'application/json' } });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('json')) throw new Error(`Jira answered HTTP ${res.status}`);
    return res.json();
  };
  try {
    let jql = query.jql;
    if (!jql && query.filterId) {
      try {
        jql = (await get(`/rest/api/3/filter/${encodeURIComponent(query.filterId)}`)).jql;
      } catch {
        return { ok: false, error: 'Jira does not share the JQL of this filter. Run it as a search first.' };
      }
    }
    if (!jql) return { ok: false, error: 'This page has no search.' };

    const issues = [];
    let token;
    let more = true;
    while (more && issues.length < max) {
      const params = new URLSearchParams({
        jql,
        fields: 'summary,status,issuetype',
        maxResults: String(Math.min(100, max - issues.length)),
      });
      if (token) params.set('nextPageToken', token);
      const page = await get(`/rest/api/3/search/jql?${params}`);
      for (const issue of page.issues ?? []) {
        issues.push({
          key: issue.key,
          summary: issue.fields?.summary ?? '',
          status: issue.fields?.status?.name ?? '',
          type: issue.fields?.issuetype?.name ?? '',
        });
      }
      token = page.nextPageToken;
      more = Boolean(token) && page.isLast !== true;
    }
    return { ok: true, issues: issues.slice(0, max), more: more || issues.length > max };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Tickets whose key or summary matches the query, from Jira's ticket picker.
 * Recently viewed tickets come first. Without a currentJQL the picker only searches history.
 */
export async function pickTickets(origin, query) {
  try {
    const params = new URLSearchParams({ query, currentJQL: 'ORDER BY updated DESC' });
    const res = await fetch(`${origin}/rest/api/3/issue/picker?${params}`, { headers: { Accept: 'application/json' } });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('json')) return { ok: false, error: `Jira answered HTTP ${res.status}` };
    const data = await res.json();
    const seen = new Set();
    const items = [];
    for (const section of data.sections ?? []) {
      for (const issue of section.issues ?? []) {
        if (seen.has(issue.key)) continue;
        seen.add(issue.key);
        items.push({ key: issue.key, summary: issue.summaryText ?? '' });
      }
    }
    return { ok: true, items: items.slice(0, 6) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Shows the action menu (menu.html) in a full-page transparent frame over the page.
 * Calling it again while the menu is open closes it. The menu asks to close by posting
 * "ticket-kit:close" to this window. Returns 'opened' or 'closed'.
 */
export function mountMenu(src) {
  const ID = 'ticket-kit-menu';
  const existing = document.getElementById(ID);
  if (existing) {
    // Same isolated world as the call that opened it, so the cleanup function is visible here.
    if (typeof existing.jlcTeardown === 'function') existing.jlcTeardown();
    else existing.remove();
    return 'closed';
  }
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = 'Jira actions';
  frame.setAttribute('allowtransparency', 'true');
  frame.style.cssText = 'display: block; border: 0; width: 100%; height: 100%; background: transparent;';
  root.append(frame);

  const teardown = () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    previousFocus?.focus?.({ preventScroll: true });
  };
  const onMessage = (event) => {
    if (event.source === frame.contentWindow && event.data === 'ticket-kit:close') teardown();
  };
  // Keys typed before the frame has focus land on the page, where Jira has single-key shortcuts
  // ("c" creates a ticket). Keep them away from Jira: Escape closes, anything else moves focus in.
  const onKey = (event) => {
    if (document.activeElement === host) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') teardown();
    else frame.focus();
  };
  host.jlcTeardown = teardown;
  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', onKey, true);
  frame.addEventListener('load', () => frame.focus());
  document.documentElement.append(host);
  frame.focus();
  return 'opened';
}
