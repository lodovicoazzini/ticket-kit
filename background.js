import {
  DEFAULT_SETTINGS, LIST_MAX, branchName, branchPrefix, branchPrefixChoices, buildClipboard, buildListClipboard,
  escapeXml, extractKey, extractSearch, gitSwitch, isJiraCloudHost, issueUrl, keysInText, keysJql, searchUrl,
  siteOrigin, textSearchJql, ticketValues,
} from './lib/format.js';
import {
  mountMenu, pickTickets, readDev, readSelection, readTicket, runSearch, showToast,
} from './lib/inject.js';

const COMMAND = {
  menu: 'open-menu',
  link: 'copy-link',
  branch: 'copy-branch',
  pr: 'open-pr',
  list: 'copy-list',
};
const MENU_MARKDOWN = 'copy-markdown';
const MENU_URL = 'copy-url';
const MENU_ISSUE_LINK = 'copy-issue-link';
const MENU_SELECTION = 'open-selection';

const BADGE = {
  ok: { text: '✓', color: '#17794a' },
  warn: { text: '!', color: '#a36400' },
  err: { text: '!', color: '#b5382a' },
};
const STATUS_ORDER = { OPEN: 0, MERGED: 1, DECLINED: 2 };
const EXACT_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

// ---------- Entry points ----------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') await migrateSettings();
  chrome.contextMenus.removeAll(() => {
    // Right-click on the toolbar icon. Chrome adds its own "Options" entry below these.
    chrome.contextMenus.create({ id: MENU_MARKDOWN, title: 'Copy as Markdown', contexts: ['action'] });
    chrome.contextMenus.create({ id: MENU_URL, title: 'Copy URL', contexts: ['action'] });
    // Right-click on a ticket link: board card keys, search result keys, links in Confluence.
    chrome.contextMenus.create({
      id: MENU_ISSUE_LINK,
      title: 'Copy Jira link',
      contexts: ['link'],
      targetUrlPatterns: ['*://*/*browse/*'],
      documentUrlPatterns: ['https://*.atlassian.net/*'],
    });
    // Right-click on selected text anywhere. Chrome passes the selection, so no page access is needed.
    chrome.contextMenus.create({ id: MENU_SELECTION, title: 'Open in Jira: %s', contexts: ['selection'] });
  });
});

chrome.action.onClicked.addListener((tab) => {
  rememberSite(tab);
  copyTicket(tab, 'link');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  // A shortcut with scope "Global" arrives without a tab and without activeTab, because Chromium's
  // global command registry has no tab list. Dia seems to need Global scope for extension shortcuts.
  // The atlassian.net host permission is what lets us read this tab's URL and run scripts in it.
  const target = tab ?? await activeTab();
  if (!target) {
    await notify(undefined, 'err');
    return;
  }
  rememberSite(target);
  if (command === COMMAND.menu) await openMenu(target);
  else if (command === COMMAND.link) await copyTicket(target, 'link');
  else if (command === COMMAND.branch) await copyBranch(target);
  else if (command === COMMAND.pr) await openPullRequest(target);
  else if (command === COMMAND.list) await copyList(target, 'list');
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  rememberSite(tab);
  if (info.menuItemId === MENU_MARKDOWN) copyTicket(tab, 'markdown');
  else if (info.menuItemId === MENU_URL) copyTicket(tab, 'url');
  else if (info.menuItemId === MENU_ISSUE_LINK) copyTicket(tab, 'link', info.linkUrl);
  else if (info.menuItemId === MENU_SELECTION) openFromSelection(tab, info.selectionText ?? '');
});

// ---------- Copy the ticket link (unchanged behaviour) ----------

/**
 * Copies the ticket open in the tab, or the ticket a right-clicked link points to.
 * The clipboard is only touched when a key was found.
 */
async function copyTicket(tab, formatId, linkUrl) {
  const source = linkUrl ?? tab.url ?? '';
  const key = extractKey(source);
  if (!key) {
    await notifyNoTicket(tab.id);
    return;
  }

  const origin = new URL(source).origin;
  const [ticket, settings] = await Promise.all([
    runInTab(tab.id, readTicket, [key, origin, !linkUrl]),
    loadSettings(),
  ]);
  const values = ticketValues({ ...ticket, key }, origin);
  const clip = buildClipboard(formatId, values, settings);
  if (!await copyOrReport(tab.id, clip)) return;

  if (clip.usesSummary && !ticket?.summary) {
    await notify(tab.id, 'warn', `Copied ${key} without its summary`,
      'Jira did not return it. Reload the page if your session expired.');
    return;
  }
  const title = {
    link: `Copied ${key}`,
    markdown: `Copied ${key} as Markdown`,
    url: `Copied the URL of ${key}`,
  }[formatId];
  await notify(tab.id, 'ok', title, clip.preview);
}

// ---------- 1. Branch name ----------

/**
 * Copies a branch name. Without a name it builds the default one for the ticket in the tab:
 * prefix from the issue type, then KEY and the summary as a slug.
 * With git: true it copies "git switch -c name" (new) or "git switch name" (existing).
 */
async function copyBranch(tab, { name, git = false, isNew = true } = {}) {
  let branch = name;
  let missingSummary = false;
  if (!branch) {
    const key = extractKey(tab.url ?? '');
    if (!key) {
      await notifyNoTicket(tab.id);
      return;
    }
    const origin = new URL(tab.url).origin;
    const [ticket, settings] = await Promise.all([runInTab(tab.id, readTicket, [key, origin, true]), loadSettings()]);
    branch = branchName(branchPrefix(ticket?.type, settings), key, ticket?.summary);
    missingSummary = !ticket?.summary;
  }
  const text = git ? gitSwitch(branch, isNew) : branch;
  if (!await copyOrReport(tab.id, { text })) return;
  if (missingSummary) {
    await notify(tab.id, 'warn', 'Copied the branch name without a description',
      'Jira did not return the summary or the issue type, so the prefix may be wrong.');
    return;
  }
  await notify(tab.id, 'ok', git ? 'Copied the git command' : 'Copied the branch name', text);
}

async function branchChoices(tab) {
  const key = extractKey(tab.url ?? '');
  if (!key) return { ok: false, error: 'No Jira ticket in this tab.' };
  const origin = new URL(tab.url).origin;
  const [dev, settings] = await Promise.all([runInTab(tab.id, readDev, [origin, key, 'branch']), loadSettings()]);
  // The dev panel call also returns summary and type. If it failed, still offer new branch names.
  const info = dev?.ok ? dev : await runInTab(tab.id, readTicket, [key, origin, true]);
  return {
    ok: true,
    key,
    type: info?.type ?? '',
    fresh: branchPrefixChoices(info?.type, settings).map((p) => branchName(p, key, info?.summary)),
    existing: dev?.ok ? dev.items : [],
    existingError: dev?.ok ? null : (dev?.error ?? 'Could not read the branches from Jira.'),
  };
}

// ---------- 2. Search results as a list ----------

async function copyList(tab, formatId) {
  const search = extractSearch(tab.url ?? '');
  if (!search) {
    await notify(tab.id, 'err', 'No Jira search on this page', 'Open a search or a saved filter, then try again.');
    return;
  }
  const origin = new URL(tab.url).origin;
  const [result, settings] = await Promise.all([runInTab(tab.id, runSearch, [origin, search, LIST_MAX]), loadSettings()]);
  if (!result?.ok) {
    await notify(tab.id, 'err', 'Could not run this search', result?.error ?? 'The page did not answer. Reload it and try again.');
    return;
  }
  const { issues, more } = result;
  if (!issues.length) {
    await notify(tab.id, 'warn', 'This search has no tickets', 'Nothing was copied.');
    return;
  }
  const clip = buildListClipboard(formatId, issues, origin, settings);
  if (!await copyOrReport(tab.id, clip)) return;
  const count = more ? `the first ${issues.length} tickets` : `${issues.length} ticket${issues.length === 1 ? '' : 's'}`;
  const as = formatId === 'markdown' ? 'as Markdown' : 'as a list';
  await notify(tab.id, 'ok', `Copied ${count} ${as}`, `${issues[0].key} - ${issues[0].summary}`);
}

// ---------- 5. Keys in selected text ----------

async function openFromSelection(tab, text) {
  const keys = keysInText(text);
  if (!keys.length) {
    await notify(tab.id, 'err', 'No ticket key in the selection', 'Select text that contains a key like ABC-123.');
    return;
  }
  await openKeys(keys, tab);
}

async function openKeys(keys, tab, disposition) {
  const origin = await jiraOriginFor(tab);
  if (!origin) return askForSite(tab);
  const url = keys.length === 1 ? issueUrl(origin, keys[0]) : searchUrl(origin, keysJql(keys));
  await openUrl(url, tab, disposition);
}

async function openTextSearch(text, tab, disposition) {
  const origin = await jiraOriginFor(tab);
  if (!origin) return askForSite(tab);
  await openUrl(searchUrl(origin, textSearchJql(text)), tab, disposition);
}

/** The tab's own Jira site when it is on one, else the site from Options, else null. */
async function jiraOriginFor(tab) {
  const tabOrigin = originOf(tab?.url);
  if (tabOrigin && isJiraCloudHost(new URL(tabOrigin).hostname)) return tabOrigin;
  return siteOrigin((await loadSettings()).jiraSite);
}

/** Without a known Jira site there is nowhere to open a key. Say so and open Options. */
async function askForSite(tab) {
  if (tab) await notify(tab.id, 'err', 'Ticket Kit doesn\'t know your Jira site yet', 'Enter it in Options, or use Ticket Kit once on a Jira tab.');
  await chrome.runtime.openOptionsPage();
}

/** The first time the extension is used on a Jira Cloud tab, that site becomes the default. */
async function rememberSite(tab) {
  const origin = originOf(tab?.url);
  if (!origin || !isJiraCloudHost(new URL(origin).hostname)) return;
  const { jiraSite } = await chrome.storage.sync.get({ jiraSite: '' });
  if (!String(jiraSite).trim()) await chrome.storage.sync.set({ jiraSite: new URL(origin).hostname });
}

/**
 * Version 1.2 had one setting, bugfixTypes (for example "Bug, Defect"), for the types that get bugfix/.
 * From 1.3 each type has its own line in branchRules. Carry a saved value over once.
 */
async function migrateSettings() {
  const { bugfixTypes, branchRules } = await chrome.storage.sync.get(['bugfixTypes', 'branchRules']);
  if (typeof bugfixTypes !== 'string') return;
  if (branchRules === undefined) {
    const lines = bugfixTypes.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `${t} = bugfix`);
    await chrome.storage.sync.set({ branchRules: lines.join('\n') });
  }
  await chrome.storage.sync.remove('bugfixTypes');
}

// ---------- 6. Address bar keyword "j" ----------

let latestOmniboxText = '';

chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({ description: 'Type a ticket key like ABC-123, or words to search Jira' });
});

chrome.omnibox.onInputChanged.addListener(async (input, suggest) => {
  const text = input.trim();
  latestOmniboxText = text;
  if (EXACT_KEY.test(text)) {
    chrome.omnibox.setDefaultSuggestion({ description: `Open <match>${escapeXml(text.toUpperCase())}</match>` });
    suggest([]);
    return;
  }
  if (text.length < 2) {
    chrome.omnibox.setDefaultSuggestion({ description: 'Type a ticket key like ABC-123, or words to search Jira' });
    suggest([]);
    return;
  }
  chrome.omnibox.setDefaultSuggestion({ description: `Search Jira for <match>${escapeXml(text)}</match>` });
  const items = await findTickets(text);
  if (latestOmniboxText !== text) return; // the user kept typing
  suggest(items.map((item) => ({
    content: item.key,
    description: `<url>${escapeXml(item.key)}</url> <dim>${escapeXml(item.summary)}</dim>`,
  })));
});

chrome.omnibox.onInputEntered.addListener(async (input, disposition) => {
  const text = input.trim();
  const tab = await activeTab();
  if (EXACT_KEY.test(text)) await openKeys([text.toUpperCase()], tab, disposition);
  else if (text) await openTextSearch(text, tab, disposition);
});

/**
 * Tickets matching words, from Jira's ticket picker. Runs inside a Jira tab when one is open,
 * like every other Jira call. Otherwise it calls Jira from the service worker, which only works
 * if the browser sends the Jira login cookie with extension requests.
 */
async function findTickets(query, preferTab) {
  const origin = await jiraOriginFor(preferTab);
  if (!origin) return [];
  let tabId = preferTab && originOf(preferTab.url) === origin ? preferTab.id : undefined;
  if (tabId === undefined) {
    const [jiraTab] = await chrome.tabs.query({ url: `${origin}/*`, discarded: false });
    tabId = jiraTab?.id;
  }
  if (tabId !== undefined) {
    const result = await runInTab(tabId, pickTickets, [origin, query]);
    if (result?.ok) return result.items;
  }
  try {
    const params = new URLSearchParams({ query, currentJQL: 'ORDER BY updated DESC' });
    const res = await fetch(`${origin}/rest/api/3/issue/picker?${params}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return [];
    const data = await res.json();
    const seen = new Set();
    return (data.sections ?? []).flatMap((s) => s.issues ?? [])
      .filter((i) => !seen.has(i.key) && seen.add(i.key))
      .map((i) => ({ key: i.key, summary: i.summaryText ?? '' }))
      .slice(0, 6);
  } catch {
    return [];
  }
}

// ---------- 7. Pull requests ----------

async function pullRequests(tab) {
  const key = extractKey(tab.url ?? '');
  if (!key) return { ok: false, error: 'No Jira ticket in this tab.' };
  const result = await runInTab(tab.id, readDev, [new URL(tab.url).origin, key, 'pullrequest']);
  if (!result?.ok) return { ok: false, key, error: result?.error ?? 'The page did not answer. Reload it and try again.' };
  const items = [...result.items].sort((a, b) => (
    (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || String(b.updated).localeCompare(String(a.updated))
  ));
  return { ok: true, key, items };
}

/** Exactly one open pull request opens directly. Otherwise the menu shows the list. */
async function openPullRequest(tab) {
  const key = extractKey(tab.url ?? '');
  if (!key) {
    await notifyNoTicket(tab.id);
    return;
  }
  const result = await pullRequests(tab);
  if (!result.ok) {
    await notify(tab.id, 'err', 'Could not read the pull requests', result.error);
    return;
  }
  if (!result.items.length) {
    await notify(tab.id, 'warn', `No pull request linked to ${key}`, "Jira's Development panel lists none.");
    return;
  }
  const open = result.items.filter((p) => p.status === 'OPEN');
  if (open.length === 1) {
    await openUrl(open[0].url, tab);
    return;
  }
  await openMenu(tab, 'pr');
}

// ---------- The action menu ----------

/** Shows the menu over the page. Where the page can't be scripted, opens it as a small window. */
async function openMenu(tab, level = 'root') {
  const query = (mode) => new URLSearchParams({ tab: String(tab.id), mode, level }).toString();
  const result = await runInTab(tab.id, mountMenu, [chrome.runtime.getURL(`menu.html?${query('overlay')}`)]);
  if (result) return;

  const width = 680;
  const height = 520;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  await chrome.windows.create({
    url: chrome.runtime.getURL(`menu.html?${query('window')}`),
    type: 'popup',
    width,
    height,
    focused: true,
    ...(win ? {
      left: Math.max(0, Math.round(win.left + (win.width - width) / 2)),
      top: Math.max(0, Math.round(win.top + Math.min(120, (win.height - height) / 2))),
    } : {}),
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type !== 'string' || !message.type.startsWith('menu:')) return false;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('menu.html'))) return false;
  handleMenuMessage(message).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

async function handleMenuMessage({ type, tabId, action, args = {}, query }) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (type === 'menu:context') {
    await rememberSite(tab);
    return menuContext(tab);
  }
  if (!tab) return { ok: false, error: 'The tab was closed.' };
  if (type === 'menu:branches') return branchChoices(tab);
  if (type === 'menu:prs') return pullRequests(tab);
  if (type === 'menu:picker') return { ok: true, items: await findTickets(query, tab) };
  if (type === 'menu:run') {
    await runMenuAction(tab, action, args);
    return { ok: true };
  }
  return { ok: false, error: `Unknown request ${type}` };
}

async function runMenuAction(tab, action, args) {
  switch (action) {
    case 'copy-link': return copyTicket(tab, 'link');
    case 'copy-markdown': return copyTicket(tab, 'markdown');
    case 'copy-url': return copyTicket(tab, 'url');
    case 'copy-branch': return copyBranch(tab, args);
    case 'copy-list': return copyList(tab, args.format === 'markdown' ? 'markdown' : 'list');
    case 'open-url': return openUrl(args.url, tab);
    case 'open-keys': return openKeys(keysInText((args.keys ?? []).join(' ')), tab);
    case 'search-text': return openTextSearch(String(args.text ?? ''), tab);
    case 'options': return chrome.runtime.openOptionsPage();
    default: throw new Error(`Unknown action ${action}`);
  }
}

/** What the menu needs to draw its first screen. */
async function menuContext(tab) {
  const settings = await loadSettings();
  const url = tab?.url ?? '';
  const origin = originOf(url);
  const key = origin ? extractKey(url) : null;
  const search = origin ? extractSearch(url) : null;
  const [ticket, selection] = await Promise.all([
    key ? runInTab(tab.id, readTicket, [key, origin, true]) : null,
    tab ? runInTab(tab.id, readSelection, []) : '',
  ]);

  let previews = null;
  if (key) {
    const values = ticketValues({ ...ticket, key }, origin);
    previews = {
      summary: ticket?.summary ?? '',
      type: ticket?.type ?? '',
      link: buildClipboard('link', values, settings).preview,
      markdown: buildClipboard('markdown', values, settings).text,
      url: buildClipboard('url', values, settings).text,
      branch: branchName(branchPrefix(ticket?.type, settings), key, ticket?.summary),
    };
  }
  return {
    ok: true,
    host: origin ? new URL(origin).host : '',
    key,
    ticket: previews,
    search: search ? (search.jql ?? `Saved filter ${search.filterId}`) : null,
    selectionKeys: keysInText(selection ?? ''),
  };
}

// ---------- Shared plumbing ----------

async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...await chrome.storage.sync.get(DEFAULT_SETTINGS) };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function originOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Opens a link next to the tab, honouring the address bar's disposition when there is one. */
async function openUrl(url, tab, disposition = 'newForegroundTab') {
  if (!/^https:\/\//.test(url ?? '')) throw new Error('Refusing to open a link that is not https');
  if (disposition === 'currentTab' && tab) {
    await chrome.tabs.update(tab.id, { url });
    return;
  }
  await chrome.tabs.create({
    url,
    active: disposition !== 'newBackgroundTab',
    ...(tab ? { windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id } : {}),
  });
}

async function runInTab(tabId, func, args) {
  if (tabId === undefined) return undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return injection?.result;
  } catch (err) {
    // chrome:// pages, the Web Store, other sites in Dia, and closed tabs refuse scripts.
    console.warn('Could not run in tab', err);
    return undefined;
  }
}

function notifyNoTicket(tabId) {
  return notify(tabId, 'err', 'No Jira ticket on this page', 'Open a ticket, then try again.');
}

/** Writes to the clipboard, or shows an error and returns false. */
async function copyOrReport(tabId, clip) {
  try {
    await writeClipboard(clip);
    return true;
  } catch (err) {
    console.error('Clipboard write failed', err);
    await notify(tabId, 'err', 'Could not write to the clipboard', 'Try again. If it keeps failing, reload the extension.');
    return false;
  }
}

/**
 * Badge on the toolbar icon for 2.5 seconds, plus a notice in the page when the page allows scripts.
 * Without a tabId the badge goes on every tab and there is no notice.
 */
async function notify(tabId, kind, title, detail) {
  const { text, color } = BADGE[kind];
  try {
    await Promise.all([
      chrome.action.setBadgeBackgroundColor({ tabId, color }),
      chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }),
      chrome.action.setBadgeText({ tabId, text }),
    ]);
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2500);
  } catch (err) {
    console.warn('Could not set badge', err);
  }
  if (tabId !== undefined) await runInTab(tabId, showToast, [kind, title, detail]);
}

// The service worker has no DOM, so the clipboard write happens in an offscreen document.
let creatingOffscreen;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: 'Write the copied Jira link to the clipboard.',
  }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
}

async function writeClipboard({ html, text }) {
  await ensureOffscreen();
  const ok = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', html, text });
  if (ok !== true) throw new Error('The offscreen document could not copy');
}
