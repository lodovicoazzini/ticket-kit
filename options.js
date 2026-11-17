import {
  DEFAULT_SETTINGS, PLACEHOLDERS, branchName, branchPrefix, buildClipboard, parseBranchRules, siteOrigin, ticketValues,
  unknownPlaceholders,
} from './lib/format.js';

// A made-up ticket whose summary has the characters that need escaping.
const SAMPLE_TICKET = {
  key: 'PAY-1284',
  summary: 'Refund export skips orders with "&" in the [customer] name',
  type: 'Bug',
  status: 'In Progress',
  project: 'Payments',
};
const SAMPLE = ticketValues(SAMPLE_TICKET, 'https://your-team.atlassian.net');

const FIELDS = Object.keys(DEFAULT_SETTINGS);
const TEMPLATE_FIELDS = ['linkText', 'plainText', 'markdown', 'url'];
const $ = (id) => document.getElementById(id);
let lastTemplateField = null;
let saveTimer;

init();

async function init() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  for (const id of FIELDS) {
    const input = $(id);
    input.value = stored[id];
    input.addEventListener('input', () => { render(); scheduleSave(); });
    if (TEMPLATE_FIELDS.includes(id)) input.addEventListener('focus', () => { lastTemplateField = input; });
  }

  for (const name of PLACEHOLDERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `{${name}}`;
    button.addEventListener('click', () => insert(`{${name}}`));
    const value = document.createElement('span');
    value.textContent = SAMPLE[name];
    $('placeholders').append(button, value);
  }

  $('reset').addEventListener('click', async () => {
    for (const id of FIELDS) $(id).value = DEFAULT_SETTINGS[id];
    render();
    await save();
  });
  $('change-shortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  await showShortcuts();
  render();
}

function insert(token) {
  const input = lastTemplateField ?? $('linkText');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + token + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + token.length, start + token.length);
  render();
  scheduleSave();
}

function currentSettings() {
  return Object.fromEntries(FIELDS.map((id) => [id, $(id).value]));
}

function render() {
  const settings = currentSettings();
  const link = buildClipboard('link', SAMPLE, settings);

  const anchor = document.createElement('a');
  anchor.href = SAMPLE.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.textContent = link.preview;
  $('linkText-out').replaceChildren(anchor);
  $('plainText-out').textContent = link.text;
  $('markdown-out').textContent = buildClipboard('markdown', SAMPLE, settings).text;
  $('url-out').textContent = buildClipboard('url', SAMPLE, settings).text;

  // Branch names: one example per rule, then one for a type without a rule.
  const { rules, errors } = parseBranchRules(settings.branchRules);
  const examples = [...rules.map((r) => r.type), 'Story'].filter((t, i, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  const width = Math.max(...examples.map((t) => t.length)) + 1;
  $('branch-out').textContent = examples
    .map((type) => `${`${type}:`.padEnd(width + 1)}${branchName(branchPrefix(type, settings), SAMPLE_TICKET.key, 'Refund export skips orders with an ampersand')}`)
    .join('\n');
  $('branchRules-msg').dataset.kind = 'err';
  $('branchRules-msg').textContent = errors.length
    ? `Line ${errors.join(', ')} ${errors.length === 1 ? 'is' : 'are'} ignored. Write each rule as "Issue type = prefix".`
    : '';
  $('branchRules').setAttribute('aria-invalid', String(errors.length > 0));

  const site = settings.jiraSite.trim();
  $('jiraSite-msg').dataset.kind = 'warn';
  $('jiraSite-msg').textContent = !site
    ? 'Not set yet.'
    : siteOrigin(site) ? '' : 'Enter a Jira Cloud address like your-team.atlassian.net. Ticket Kit can only read atlassian.net sites.';
  $('jiraSite').setAttribute('aria-invalid', String(Boolean(site) && !siteOrigin(site)));

  for (const id of TEMPLATE_FIELDS) {
    const value = settings[id];
    const unknown = unknownPlaceholders(value);
    const msg = $(`${id}-msg`);
    $(id).setAttribute('aria-invalid', String(unknown.length > 0));
    if (unknown.length) {
      msg.dataset.kind = 'err';
      msg.textContent = `Unknown placeholder ${unknown.map((n) => `{${n}}`).join(', ')}. It is copied as typed.`;
    } else if (!value.trim()) {
      msg.dataset.kind = 'warn';
      msg.textContent = {
        linkText: 'Empty. The link text falls back to {key}.',
        plainText: 'Empty. Plain-text targets get the URL instead.',
        markdown: 'Empty. Copy as Markdown copies the URL instead.',
        url: 'Empty. Copy URL copies the plain URL.',
      }[id];
    } else {
      msg.textContent = '';
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('');
  saveTimer = setTimeout(save, 300);
}

async function save() {
  clearTimeout(saveTimer);
  try {
    await chrome.storage.sync.set(currentSettings());
    setStatus('Saved', 'ok');
  } catch (err) {
    setStatus(`Not saved: ${err.message}`, 'err');
  }
}

function setStatus(text, kind) {
  $('status').textContent = text;
  if (kind) $('status').dataset.kind = kind;
}

async function showShortcuts() {
  const commands = await chrome.commands.getAll();
  const list = $('shortcuts');
  list.textContent = '';
  for (const command of commands) {
    if (command.name === '_execute_action') continue;
    const dt = document.createElement('dt');
    dt.textContent = command.description;
    const dd = document.createElement('dd');
    if (command.shortcut) {
      const kbd = document.createElement('span');
      kbd.className = 'shortcut';
      kbd.textContent = command.shortcut;
      dd.append(kbd);
    } else {
      dd.className = 'none';
      dd.textContent = 'Not set';
    }
    list.append(dt, dd);
  }
  const copyLink = commands.find((c) => c.name === 'copy-link')?.shortcut;
  $('shortcut-inline').textContent = copyLink ? `the shortcut (${copyLink})` : 'the shortcut';
}
