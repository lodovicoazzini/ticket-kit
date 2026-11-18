import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, buildClipboard, buildListClipboard, extractKey, fillTemplate, linkParts, ticketValues,
  unknownPlaceholders,
} from '../lib/format.js';

const ORIGIN = 'https://your-team.atlassian.net';

test('extractKey finds the key in every Jira URL shape seen on the site', () => {
  const cases = {
    [`${ORIGIN}/jira/browse/PAY-9678`]: 'PAY-9678',
    [`${ORIGIN}/browse/PAY-3407`]: 'PAY-3407',
    [`${ORIGIN}/browse/PAY-1?focusedCommentId=5`]: 'PAY-1',
    [`${ORIGIN}/jira/software/c/projects/PAY/boards/19?selectedIssue=PAY-3407`]: 'PAY-3407',
    [`${ORIGIN}/issues?jql=project%20%3D%20PAY%20ORDER%20BY%20updated%20DESC&selectedIssue=PAY-9415`]: 'PAY-9415',
    [`${ORIGIN}/jira/servicedesk/projects/SUP/queues/custom/12/SUP-67382`]: 'SUP-67382',
    [`${ORIGIN}/browse/pay-9678`]: 'PAY-9678',
    [`${ORIGIN}/browse/OPS-10`]: 'OPS-10',
    [`${ORIGIN}/browse/DOCS-103332`]: 'DOCS-103332',
  };
  for (const [url, key] of Object.entries(cases)) assert.equal(extractKey(url), key, url);
});

test('extractKey returns null when no ticket is open', () => {
  for (const url of [
    `${ORIGIN}/issues/?jql=project%20%3D%20PAY`,
    `${ORIGIN}/jira/your-work`,
    `${ORIGIN}/jira/software/c/projects/PAY/boards/19`,
    `${ORIGIN}/jira/software/c/projects/PAY/boards/19?selectedIssue=nonsense`,
    'chrome://newtab/',
    'not a url',
    '',
  ]) assert.equal(extractKey(url), null, url);
});

test('default copy is an escaped HTML link plus "KEY - Summary" as plain text', () => {
  const values = ticketValues({
    key: 'PAY-9678',
    summary: 'Refund export cannot be retried: v1 PATCH answers 500 and the desktop save fails with "the new order is not a Refund"',
  }, ORIGIN);
  const clip = buildClipboard('link', values, DEFAULT_SETTINGS);
  assert.equal(clip.html,
    '<a href="https://your-team.atlassian.net/browse/PAY-9678">PAY-9678 - Refund export cannot be retried: '
    + 'v1 PATCH answers 500 and the desktop save fails with &quot;the new order is not a Refund&quot;</a>');
  assert.equal(clip.text,
    'PAY-9678 - Refund export cannot be retried: v1 PATCH answers 500 and the desktop save fails with "the new order is not a Refund"');
  assert.equal(clip.usesSummary, true);
});

test('HTML special characters in the summary are escaped', () => {
  const values = ticketValues({ key: 'SUP-1', summary: 'Smith&Sons <script>' }, ORIGIN);
  assert.equal(buildClipboard('link', values).html,
    '<a href="https://your-team.atlassian.net/browse/SUP-1">SUP-1 - Smith&amp;Sons &lt;script&gt;</a>');
});

test('Markdown escapes brackets in the summary but not in the URL', () => {
  const values = ticketValues({ key: 'PAY-9836', summary: '[Payments] Job failed' }, ORIGIN);
  assert.equal(buildClipboard('markdown', values).text,
    '[PAY-9836 - \\[Payments\\] Job failed](https://your-team.atlassian.net/browse/PAY-9836)');
});

test('URL format copies the canonical /browse/ link', () => {
  const values = ticketValues({ key: 'PAY-9253', summary: 'x' }, ORIGIN);
  const clip = buildClipboard('url', values);
  assert.equal(clip.text, 'https://your-team.atlassian.net/browse/PAY-9253');
  assert.equal(clip.html, undefined);
  assert.equal(clip.usesSummary, false);
});

test('a missing summary drops the dangling separator', () => {
  const values = ticketValues({ key: 'PAY-1' }, ORIGIN);
  const link = buildClipboard('link', values);
  assert.equal(link.html, '<a href="https://your-team.atlassian.net/browse/PAY-1">PAY-1</a>');
  assert.equal(link.text, 'PAY-1');
  assert.equal(buildClipboard('markdown', values).text, '[PAY-1](https://your-team.atlassian.net/browse/PAY-1)');
  assert.equal(fillTemplate('{key}: {summary}', values), 'PAY-1');
});

test('empty templates fall back to the key or the URL', () => {
  const values = ticketValues({ key: 'PAY-2', summary: 'Two' }, ORIGIN);
  const clip = buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText: '  ', plainText: '' });
  assert.equal(clip.html, '<a href="https://your-team.atlassian.net/browse/PAY-2">PAY-2</a>');
  assert.equal(clip.text, 'https://your-team.atlassian.net/browse/PAY-2');
});

test('custom templates can use type, status and project; unknown placeholders stay as typed', () => {
  const values = ticketValues({ key: 'PAY-3', summary: 'Three', type: 'Bug', status: 'Prepare', project: 'Payments' }, ORIGIN);
  assert.equal(fillTemplate('[{type}] {key} {summary} ({status}, {project}) {nope}', values),
    '[Bug] PAY-3 Three (Prepare, Payments) {nope}');
  assert.deepEqual(unknownPlaceholders('{key} {nope} {nope} {summary} {other}'), ['nope', 'other']);
});

test('[text](url) in the link text makes only that part clickable', () => {
  const values = ticketValues({ key: 'PAY-9678', summary: 'Refund <export> & retry', status: 'Done' }, ORIGIN);
  const link = (linkText) => buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText });
  const href = `${ORIGIN}/browse/PAY-9678`;

  const keyOnly = link('[{key}]({url}) - {summary}');
  assert.equal(keyOnly.html, `<a href="${href}">PAY-9678</a> - Refund &lt;export&gt; &amp; retry`);
  assert.equal(keyOnly.preview, 'PAY-9678 - Refund <export> & retry');
  assert.equal(keyOnly.text, 'PAY-9678 - Refund <export> & retry');
  assert.deepEqual(keyOnly.pieces, [{ text: 'PAY-9678', href }, { text: ' - Refund <export> & retry' }]);

  assert.equal(link('{key} - [{summary}]({url})').html, `PAY-9678 - <a href="${href}">Refund &lt;export&gt; &amp; retry</a>`);
  assert.equal(link('[{key}]({url}) [board](https://your-team.atlassian.net/jira/boards/1)').html,
    `<a href="${href}">PAY-9678</a> <a href="https://your-team.atlassian.net/jira/boards/1">board</a>`);
});

test('square brackets without (url) stay characters, and the whole text stays the link', () => {
  const values = ticketValues({ key: 'PAY-1', summary: 'One' }, ORIGIN);
  assert.equal(buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText: '[{key}] {summary}' }).html,
    `<a href="${ORIGIN}/browse/PAY-1">[PAY-1] One</a>`);
  assert.deepEqual(linkParts('{key} - {summary}'), [{ text: '{key} - {summary}', url: '{url}' }]);
  assert.deepEqual(linkParts('[{key}]({url}) - {summary}'), [{ text: '{key}', url: '{url}' }, { text: ' - {summary}' }]);
});

test('brackets in a summary never make a link', () => {
  const values = ticketValues({ key: 'PAY-1', summary: '[docs](https://evil.example) broken' }, ORIGIN);
  assert.equal(buildClipboard('link', values).html,
    `<a href="${ORIGIN}/browse/PAY-1">PAY-1 - [docs](https://evil.example) broken</a>`);
  assert.equal(buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText: '[{key}]({url}) {summary}' }).html,
    `<a href="${ORIGIN}/browse/PAY-1">PAY-1</a> [docs](https://evil.example) broken`);
});

test('a link part without an https address is plain text; with no link left, all of it links to the ticket', () => {
  const values = ticketValues({ key: 'PAY-1', summary: 'One' }, ORIGIN);
  assert.equal(buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText: '[{key}](ftp://files) {summary}' }).html,
    `<a href="${ORIGIN}/browse/PAY-1">PAY-1 One</a>`);
});

test('a missing summary leaves no dangling separator or empty link in partial links', () => {
  const values = ticketValues({ key: 'PAY-1', status: 'Done' }, ORIGIN);
  const html = (linkText) => buildClipboard('link', values, { ...DEFAULT_SETTINGS, linkText }).html;
  const a = `<a href="${ORIGIN}/browse/PAY-1">PAY-1</a>`;
  assert.equal(html('[{key}]({url}) - {summary}'), a);
  assert.equal(html('{key} - [{summary}]({url})'), a);
  assert.equal(html('[{key} - {summary}]({url}) ({status})'), `${a} (Done)`);
});

test('a copied list follows the link text template', () => {
  const issues = [{ key: 'PAY-1', summary: 'One' }, { key: 'PAY-2', summary: 'Two' }];
  const list = buildListClipboard('list', issues, ORIGIN, { ...DEFAULT_SETTINGS, linkText: '[{key}]({url}) - {summary}' });
  assert.equal(list.html, `<ul><li><a href="${ORIGIN}/browse/PAY-1">PAY-1</a> - One</li>`
    + `<li><a href="${ORIGIN}/browse/PAY-2">PAY-2</a> - Two</li></ul>`);
});
