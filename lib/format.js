// Pure helpers shared by the service worker, the options page and the tests.
// Nothing in this file touches chrome.*, so Node can import it.

export const PLACEHOLDERS = ['key', 'summary', 'url', 'type', 'status', 'project'];
export const BRANCH_PLACEHOLDERS = ['prefix', 'key', 'summary', 'type'];

export const DEFAULT_SETTINGS = Object.freeze({
  linkText: '{key} - {summary}',
  plainText: '{key} - {summary}',
  markdown: '[{key} - {summary}]({url})',
  url: '{url}',
  jiraSite: '',
  branchTemplate: '{prefix}/{key}-{summary}',
  branchDefaultPrefix: 'feature',
  branchRules: 'Bug = bugfix',
  prShortcut: 'list',
});

export const BRANCH_SLUG_MAX = 40;
export const LIST_MAX = 100;

const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

/**
 * Returns the issue key a Jira URL points at, or null.
 *
 * URL shapes seen on Jira Cloud in November 2026:
 *   /jira/browse/PAY-1284                                           full issue view
 *   /browse/PAY-1284                                                key link on a board card
 *   /jira/software/c/projects/PAY/boards/19?selectedIssue=PAY-1284  board, ticket open in a modal
 *   /issues?jql=...&selectedIssue=PAY-1284                          search, detail view
 * Service desk queues end the path with the key.
 */
export function extractKey(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const selected = url.searchParams.get('selectedIssue')?.toUpperCase();
  if (selected && KEY_RE.test(selected)) return selected;

  const browse = url.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/);
  if (browse) return browse[1].toUpperCase();

  if (url.pathname.startsWith('/jira/')) {
    const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
    if (KEY_RE.test(last)) return last;
  }
  return null;
}

export function issueUrl(origin, key) {
  return `${origin}/browse/${key}`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Brackets in link text break "[text](url)" when they are unbalanced, so escape them all.
export function escapeMarkdown(value) {
  return String(value).replace(/[\\[\]]/g, '\\$&');
}

export function unknownPlaceholders(template, known = PLACEHOLDERS) {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return [...new Set(names.filter((name) => !known.includes(name)))];
}

export function usesSummary(template) {
  return template.includes('{summary}');
}

function substitute(template, values, markdown) {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.hasOwn(values, name)) return match;
    const value = values[name] ?? '';
    return markdown && name !== 'url' ? escapeMarkdown(value) : String(value);
  });
}

const DANGLING_SEPARATOR = /\s*[-:|]\s*$/;

/**
 * Replaces {placeholders} with ticket values. Unknown placeholders stay as typed.
 * With markdown: true, every value except the URL gets its brackets escaped.
 * When the summary is missing, a separator left dangling at the end or before "]" is dropped,
 * so "{key} - {summary}" gives "PAY-1" instead of "PAY-1 -".
 */
export function fillTemplate(template, values, { markdown = false } = {}) {
  let out = substitute(template, values, markdown);
  if (!values.summary) out = out.replace(/\s*[-:|]\s*(?=\]|$)/g, '');
  return out.trim();
}

const LINK_PART = /\[([^\]]*)\]\(([^)\s]*)\)/g;

/**
 * Splits a link template into plain text and Markdown-style [text](url) parts, still unfilled:
 * "[{key}]({url}) - {summary}" gives [{ text: '{key}', url: '{url}' }, { text: ' - {summary}' }].
 * A template without a [text](url) part is one link to the ticket, as it was before 1.4:
 * "{key} - {summary}" gives [{ text: '{key} - {summary}', url: '{url}' }]. Square brackets
 * without "(url)" right after them are ordinary characters.
 */
export function linkParts(template) {
  const parts = [];
  let pos = 0;
  for (const m of template.matchAll(LINK_PART)) {
    if (m.index > pos) parts.push({ text: template.slice(pos, m.index) });
    parts.push({ text: m[1], url: m[2] });
    pos = m.index + m[0].length;
  }
  if (!parts.length) return [{ text: template, url: '{url}' }];
  if (pos < template.length) parts.push({ text: template.slice(pos) });
  return parts;
}

/**
 * Fills a link template into pieces of visible text, some with a link: [{ text, href? }].
 * The template is split before the values go in, so brackets in a summary never make a link.
 * A part whose address doesn't start with https:// is plain text.
 * When the summary is missing, separators left at the end are dropped, and so are links with
 * no text left. If no link remains, the whole text links to the ticket.
 */
export function fillLinkParts(template, values) {
  const noSummary = !values.summary;
  let pieces = linkParts(template).map((part) => {
    let text = substitute(part.text, values, false);
    if (part.url === undefined) return { text };
    const href = substitute(part.url, values, false).trim();
    if (noSummary) text = text.replace(DANGLING_SEPARATOR, '');
    if (!/^https:\/\//i.test(href)) return { text };
    if (!text.trim()) return noSummary ? { text: '' } : { text: href, href };
    return { text, href };
  });
  if (noSummary) {
    while (pieces.length && !pieces.at(-1).href) {
      const text = pieces.at(-1).text.replace(DANGLING_SEPARATOR, '');
      if (text.trim()) {
        pieces.at(-1).text = text;
        break;
      }
      pieces.pop();
    }
  }
  pieces = pieces.filter((p) => p.text);
  if (pieces.length) {
    pieces[0] = { ...pieces[0], text: pieces[0].text.trimStart() };
    pieces[pieces.length - 1] = { ...pieces.at(-1), text: pieces.at(-1).text.trimEnd() };
    pieces = pieces.filter((p) => p.text);
  }
  if (!pieces.some((p) => p.href)) {
    return [{ text: pieces.map((p) => p.text).join('') || values.key, href: values.url }];
  }
  return pieces;
}

export function ticketValues(ticket, origin) {
  return {
    key: ticket.key,
    summary: ticket.summary ?? '',
    url: issueUrl(origin, ticket.key),
    type: ticket.type ?? '',
    status: ticket.status ?? '',
    project: ticket.project ?? '',
  };
}

/**
 * Builds what goes on the clipboard for one format.
 *   'link'      rich text with one or more links (text/html) plus the plain-text version (text/plain)
 *   'markdown'  text/plain only
 *   'url'       text/plain only
 * Returns { html?, text, preview, pieces?, usesSummary }. preview is the line the toast shows,
 * pieces the rich text as [{ text, href? }] for drawing it without HTML.
 */
export function buildClipboard(formatId, values, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (formatId === 'markdown') {
    const text = fillTemplate(s.markdown, values, { markdown: true }) || values.url;
    return { text, preview: text, usesSummary: usesSummary(s.markdown) };
  }
  if (formatId === 'url') {
    const text = fillTemplate(s.url, values) || values.url;
    return { text, preview: text, usesSummary: usesSummary(s.url) };
  }
  const linkTemplate = s.linkText.trim() ? s.linkText : '{key}';
  const plainTemplate = s.plainText.trim() ? s.plainText : '{url}';
  const pieces = fillLinkParts(linkTemplate, values);
  const text = fillTemplate(plainTemplate, values) || values.url;
  return {
    html: pieces.map((p) => (p.href ? `<a href="${escapeHtml(p.href)}">${escapeHtml(p.text)}</a>` : escapeHtml(p.text))).join(''),
    text,
    preview: pieces.map((p) => p.text).join(''),
    pieces,
    usesSummary: usesSummary(linkTemplate) || usesSummary(plainTemplate),
  };
}

/**
 * "https://your-team.atlassian.net" from the jiraSite setting, which may be a bare host or a URL.
 * Null when the setting is empty or isn't a Jira Cloud site, the only kind the extension may read.
 */
export function siteOrigin(jiraSite) {
  const raw = String(jiraSite ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return isJiraCloudHost(url.hostname) ? `https://${url.hostname}` : null;
  } catch {
    return null;
  }
}

export function isJiraCloudHost(hostname) {
  return /^[a-z0-9-]+\.atlassian\.net$/i.test(String(hostname ?? ''));
}

// ---------- Branch names ----------

/** Lowercase, no accents, one dash between words, ends on a whole word within `max` characters. */
export function slugify(text, max = BRANCH_SLUG_MAX) {
  const base = String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= max) return base;
  const cut = base.slice(0, max + 1);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 0 ? cut.slice(0, lastDash) : base.slice(0, max)).replace(/-+$/, '');
}

/** "feature/", "/fix", " hotfix " all become "feature", "fix", "hotfix". Characters git refuses are dropped. */
export function cleanPrefix(prefix) {
  return String(prefix ?? '').trim().replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^[/.-]+|[/.-]+$/g, '');
}

/**
 * Parses the branchRules setting: one "Issue type = prefix" per line. Blank lines and lines
 * starting with # are skipped. Returns { rules: [{ type, prefix }], errors: [line numbers] }.
 */
export function parseBranchRules(text) {
  const rules = [];
  const errors = [];
  String(text ?? '').split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    const type = eq > 0 ? trimmed.slice(0, eq).trim() : '';
    if (!type) {
      errors.push(i + 1);
      return;
    }
    rules.push({ type, prefix: cleanPrefix(trimmed.slice(eq + 1)) });
  });
  return { rules, errors };
}

/** The prefix for an issue type: its rule if there is one (case-insensitive), else the default prefix. */
export function branchPrefix(issueType, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const type = String(issueType ?? '').trim().toLowerCase();
  const rule = parseBranchRules(s.branchRules).rules.find((r) => r.type.toLowerCase() === type);
  return rule ? rule.prefix : cleanPrefix(s.branchDefaultPrefix);
}

/** Every configured prefix, the issue type's own first, without duplicates. For the menu's choices. */
export function branchPrefixChoices(issueType, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const all = [
    branchPrefix(issueType, s),
    cleanPrefix(s.branchDefaultPrefix),
    ...parseBranchRules(s.branchRules).rules.map((r) => r.prefix),
  ];
  return [...new Set(all)];
}

/**
 * The branch name from the template, "{prefix}/{key}-{summary}" by default.
 * {summary} and {type} become lowercase slugs. A separator left next to an empty value is dropped,
 * so an empty prefix gives "KEY-slug", not "/KEY-slug". Falls back to the key.
 */
export function branchName(prefix, key, summary, { template, type } = {}) {
  const values = { prefix: cleanPrefix(prefix), key, summary: slugify(summary), type: slugify(type) };
  const tpl = String(template ?? '').trim() || DEFAULT_SETTINGS.branchTemplate;
  const filled = tpl.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(values, name) ? values[name] : match));
  return cleanBranchName(filled) || key;
}

/**
 * Makes text a branch name git accepts. Characters it refuses (spaces, ~ ^ : ? * [ \ @ { })
 * become dashes, "//", ".." and separators next to a slash collapse, and no part ends in ".lock".
 */
export function cleanBranchName(name) {
  return String(name ?? '')
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/[-_.]*\/[-_./]*/g, '/')
    .replace(/[-_.]{2,}/g, (run) => run[0])
    .replace(/\.lock(?=\/|$)/g, '-lock')
    .replace(/^[-_./]+|[-_./]+$/g, '');
}

export function gitSwitch(name, isNew) {
  return `git switch ${isNew ? '-c ' : ''}${name}`;
}

// ---------- Keys, searches, lists ----------

/** Ticket keys in free text, in order, without duplicates. Case-sensitive so "utf-8" doesn't count. */
export function keysInText(text) {
  return [...new Set(String(text ?? '').match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) ?? [])];
}

/** The search on a Jira page: { jql } or { filterId }, or null when the URL holds neither. */
export function extractSearch(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const jql = url.searchParams.get('jql')?.trim();
  if (jql) return { jql };
  const filter = url.searchParams.get('filter');
  if (filter && /^-?\d+$/.test(filter)) return { filterId: filter };
  return null;
}

function jqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function searchUrl(origin, jql) {
  return `${origin}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function textSearchJql(text) {
  return `text ~ ${jqlString(text.trim())} ORDER BY updated DESC`;
}

export function keysJql(keys) {
  return `key in (${keys.join(', ')})`;
}

/**
 * Clipboard content for a list of tickets.
 *   'list'      bulleted rich links (text/html), one plain-text line per ticket (text/plain)
 *   'markdown'  "- [KEY - Summary](url)" lines
 */
export function buildListClipboard(formatId, issues, origin, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const values = issues.map((issue) => ticketValues(issue, origin));
  if (formatId === 'markdown') {
    const text = values.map((v) => `- ${fillTemplate(s.markdown, v, { markdown: true }) || v.url}`).join('\n');
    return { text };
  }
  const links = values.map((v) => buildClipboard('link', v, s));
  return {
    html: `<ul>${links.map((l) => `<li>${l.html}</li>`).join('')}</ul>`,
    text: links.map((l) => l.text).join('\n'),
  };
}

/** Omnibox descriptions are XML, so &, < and > must be escaped. */
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}
