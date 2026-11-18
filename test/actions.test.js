import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRANCH_PLACEHOLDERS, branchName, branchPrefix, branchPrefixChoices, buildListClipboard, cleanBranchName, cleanPrefix,
  escapeXml, extractSearch, gitSwitch, isJiraCloudHost, keysInText, keysJql, parseBranchRules, searchUrl, siteOrigin,
  slugify, textSearchJql, unknownPlaceholders,
} from '../lib/format.js';

const ORIGIN = 'https://your-team.atlassian.net';

test('slugify: lowercase, single dashes, whole words within 40 characters', () => {
  assert.equal(slugify('Spring - DB Compression job fails - TEST-DEV env'), 'spring-db-compression-job-fails-test-dev');
  assert.equal(slugify('Advanced search: Delivery Type "Overnight" always fails (HTTP 500, API 400 Bad Request)'),
    'advanced-search-delivery-type-overnight');
  assert.equal(slugify('[Payments] Job failed'), 'payments-job-failed');
  assert.equal(slugify('Zürich Rückkauf für Kunden'), 'zurich-ruckkauf-fur-kunden');
  assert.equal(slugify('Wrong totals for refund orders'), 'wrong-totals-for-refund-orders');
  assert.equal(slugify('a'.repeat(60)), 'a'.repeat(40));
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  for (const s of ['Implementation of the quarterly cost report', 'x '.repeat(50)]) {
    assert.ok(slugify(s).length <= 40, s);
  }
});

test('branch prefix follows the rules, case-insensitive, with a default for other types', () => {
  assert.equal(branchPrefix('Bug'), 'bugfix');
  assert.equal(branchPrefix('bug'), 'bugfix');
  assert.equal(branchPrefix('Story'), 'feature');
  assert.equal(branchPrefix(undefined), 'feature');
  const team = { branchDefaultPrefix: 'feat', branchRules: 'Bug = fix\nDefect = fix\n# comment\n\nTask = chore\nSpike =' };
  assert.equal(branchPrefix('Defect', team), 'fix');
  assert.equal(branchPrefix('task', team), 'chore');
  assert.equal(branchPrefix('Spike', team), '');
  assert.equal(branchPrefix('Story', team), 'feat');
  assert.deepEqual(branchPrefixChoices('Bug', team), ['fix', 'feat', 'chore', '']);
  assert.deepEqual(branchPrefixChoices('Story'), ['feature', 'bugfix']);
});

test('branch rules report the lines they cannot read', () => {
  const { rules, errors } = parseBranchRules('Bug = bugfix\nno equals sign\n = orphan\nCustomer Support Ticket = hotfix/');
  assert.deepEqual(rules, [{ type: 'Bug', prefix: 'bugfix' }, { type: 'Customer Support Ticket', prefix: 'hotfix' }]);
  assert.deepEqual(errors, [2, 3]);
});

test('prefixes are cleaned of slashes, spaces and characters git refuses', () => {
  assert.equal(cleanPrefix(' feature/ '), 'feature');
  assert.equal(cleanPrefix('/fix'), 'fix');
  assert.equal(cleanPrefix('team/fix'), 'team/fix');
  assert.equal(cleanPrefix('bug fix~^'), 'bug-fix');
  assert.equal(cleanPrefix(''), '');
});

test('branch names and git commands', () => {
  assert.equal(branchName('feature', 'PAY-9637', 'Spring - DB Compression job fails - TEST-DEV env'),
    'feature/PAY-9637-spring-db-compression-job-fails-test-dev');
  assert.equal(branchName('bugfix', 'PAY-1', null), 'bugfix/PAY-1');
  assert.equal(branchName('', 'PAY-1', 'No prefix here'), 'PAY-1-no-prefix-here');
  assert.equal(branchName('team/fix/', 'PAY-1', 'x'), 'team/fix/PAY-1-x');
  assert.equal(gitSwitch('feature/PAY-1-x', true), 'git switch -c feature/PAY-1-x');
  assert.equal(gitSwitch('feature/PAY-1-x', false), 'git switch feature/PAY-1-x');
});

test('branch name templates', () => {
  const summary = 'Refund export skips orders with an ampersand';
  const name = (template, prefix = 'bugfix', type = 'Bug') => branchName(prefix, 'PAY-1284', summary, { template, type });
  assert.equal(name('{prefix}/{key}-{summary}'), 'bugfix/PAY-1284-refund-export-skips-orders-with-an');
  assert.equal(name(''), 'bugfix/PAY-1284-refund-export-skips-orders-with-an');
  assert.equal(name('{prefix}/{key}'), 'bugfix/PAY-1284');
  assert.equal(name('{key}_{summary}'), 'PAY-1284_refund-export-skips-orders-with-an');
  assert.equal(name('{type}/{key}', 'x', 'User Story'), 'user-story/PAY-1284');
  assert.equal(name('payments/{prefix}/{key}'), 'payments/bugfix/PAY-1284');
});

test('branch name templates drop the separator next to an empty value', () => {
  const name = (template, prefix, type = '') => branchName(prefix, 'PAY-1', 'One two', { template, type });
  assert.equal(name('{prefix}/{key}-{summary}', ''), 'PAY-1-one-two');
  assert.equal(name('payments/{prefix}/{key}', ''), 'payments/PAY-1');
  assert.equal(name('{key}-{type}_{summary}', 'x'), 'PAY-1-one-two');
  assert.equal(branchName('fix', 'PAY-1', '', { template: '{prefix}/{key}_{summary}' }), 'fix/PAY-1');
  assert.equal(name('{prefix}', ''), 'PAY-1');
});

test('branch names lose what git refuses', () => {
  assert.equal(cleanBranchName('my branch~/PAY-1..one'), 'my-branch/PAY-1.one');
  assert.equal(cleanBranchName('a//b'), 'a/b');
  assert.equal(cleanBranchName('/.a-'), 'a');
  assert.equal(cleanBranchName('PAY-1.lock'), 'PAY-1-lock');
  assert.equal(cleanBranchName('x@{y}^:?*[z]\\w'), 'x-y-z-w');
  assert.equal(branchName('bugfix', 'PAY-1', 'x', { template: '{prefix}/{nope}-{key}' }), 'bugfix/nope-PAY-1');
  assert.deepEqual(unknownPlaceholders('{prefix}/{key}-{url}', BRANCH_PLACEHOLDERS), ['url']);
});

test('keysInText finds keys in order without duplicates and ignores lowercase', () => {
  assert.deepEqual(keysInText('can you check PAY-9678 before the release? see PAY-9678 and SUP-67382'), ['PAY-9678', 'SUP-67382']);
  assert.deepEqual(keysInText('[PAY-9836] Job failed'), ['PAY-9836']);
  assert.deepEqual(keysInText('utf-8 and pay-1 are not keys'), []);
  assert.deepEqual(keysInText(''), []);
  assert.equal(keysJql(['PAY-1', 'SUP-2']), 'key in (PAY-1, SUP-2)');
});

test('extractSearch reads the JQL or the saved filter from a Jira URL', () => {
  assert.deepEqual(extractSearch(`${ORIGIN}/issues?jql=project%20%3D%20PAY%20ORDER%20BY%20updated%20DESC&selectedIssue=PAY-9415`),
    { jql: 'project = PAY ORDER BY updated DESC' });
  assert.deepEqual(extractSearch(`${ORIGIN}/issues/?filter=12345`), { filterId: '12345' });
  assert.deepEqual(extractSearch(`${ORIGIN}/issues/?filter=-1`), { filterId: '-1' });
  assert.equal(extractSearch(`${ORIGIN}/jira/browse/PAY-1`), null);
  assert.equal(extractSearch(`${ORIGIN}/issues/?jql=`), null);
  assert.equal(extractSearch('not a url'), null);
});

test('search URLs quote text safely', () => {
  assert.equal(textSearchJql('say "hi" \\ there'), 'text ~ "say \\"hi\\" \\\\ there" ORDER BY updated DESC');
  assert.equal(searchUrl(ORIGIN, 'key in (PAY-1, SUP-2)'), `${ORIGIN}/issues/?jql=key%20in%20(PAY-1%2C%20SUP-2)`);
});

test('list clipboard: rich bullet list, plain lines, Markdown lines', () => {
  const issues = [
    { key: 'PAY-9836', summary: '[Payments] Job failed' },
    { key: 'SUP-1', summary: 'Smith&Sons <x>' },
  ];
  const list = buildListClipboard('list', issues, ORIGIN);
  assert.equal(list.html,
    '<ul><li><a href="https://your-team.atlassian.net/browse/PAY-9836">PAY-9836 - [Payments] Job failed</a></li>'
    + '<li><a href="https://your-team.atlassian.net/browse/SUP-1">SUP-1 - Smith&amp;Sons &lt;x&gt;</a></li></ul>');
  assert.equal(list.text, 'PAY-9836 - [Payments] Job failed\nSUP-1 - Smith&Sons <x>');
  const md = buildListClipboard('markdown', issues, ORIGIN);
  assert.equal(md.html, undefined);
  assert.equal(md.text,
    '- [PAY-9836 - \\[Payments\\] Job failed](https://your-team.atlassian.net/browse/PAY-9836)\n'
    + '- [SUP-1 - Smith&Sons <x>](https://your-team.atlassian.net/browse/SUP-1)');
});

test('site origin accepts a Jira Cloud host or URL, and nothing else', () => {
  assert.equal(siteOrigin('your-team.atlassian.net'), ORIGIN);
  assert.equal(siteOrigin(' https://your-team.atlassian.net/jira/your-work '), ORIGIN);
  assert.equal(siteOrigin('http://your-team.atlassian.net'), ORIGIN);
  assert.equal(siteOrigin(''), null);
  assert.equal(siteOrigin(undefined), null);
  assert.equal(siteOrigin('jira.example.com'), null);
  assert.equal(siteOrigin('your-team.atlassian.net.evil.com'), null);
  assert.equal(siteOrigin('http://[bad'), null);
  assert.equal(isJiraCloudHost('your-team.atlassian.net'), true);
  assert.equal(isJiraCloudHost('atlassian.net'), false);
});

test('omnibox descriptions escape XML', () => {
  assert.equal(escapeXml('A & B <c> "d"'), 'A &amp; B &lt;c&gt; &quot;d&quot;');
});
