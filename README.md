# Ticket Kit

A browser extension for people who live in Jira Cloud. It copies the open ticket as a link named after it, copies a
branch name or a whole search as a list, opens tickets from selected text or the address bar, and opens a ticket's
pull request. One shortcut opens a menu with every action, searchable by text.

Works in Chrome, Edge and other Chromium browsers (Dia included) with Jira Cloud sites on `atlassian.net`.
Self-hosted Jira (Server or Data Center) isn't supported.

## What it does

| Action | Default shortcut | Result |
|---|---|---|
| Open the action menu | Alt+Shift+K | A menu over the page with every action for the tab. Type to filter, type a key like `PAY-1284` to open it, or type words to search Jira. |
| Copy link | Alt+Shift+J, or click the toolbar icon | A rich link reading `PAY-1284 - Summary`. Teams, Outlook, Slack and Confluence paste it as a link; terminals and commit dialogs get the plain text. |
| Copy as Markdown, Copy URL | none | In the menu, and on the toolbar icon's right-click menu. |
| Copy branch name | Alt+Shift+B | `bugfix/PAY-1284-refund-export-skips-orders-with-an`. The prefix follows your rules per issue type. In the menu you also get the other prefixes and the branches already linked in Jira. Alt+Enter copies `git switch -c ...` instead. |
| Open pull request | Alt+Shift+P | Opens the ticket's only open pull request, or lists them all (open, merged, declined) in the menu. |
| Copy results as a list | none, set your own | On a Jira search, saved filter or list view: up to 100 tickets as a bulleted list of links. "Copy results as Markdown" gives `- [KEY - Summary](url)` lines. |
| Open in Jira | right-click selected text | Opens the key in the selection. Several keys open one search. Works on any site. |
| Address bar keyword | type `j` and a space | `j PAY-1284` opens the ticket; `j refund export` suggests matching tickets. |

It works wherever a ticket is open: the full issue view, a ticket opened on a board, and the selected row in search
detail view. Right-clicking a ticket key on a board or in search results also offers "Copy Jira link".

After each action a short notice appears at the bottom of the page and the toolbar icon shows a badge:
green ✓ for done, amber ! for done with a caveat (for example the summary couldn't be read), red ! for nothing done.

Browsers let an extension suggest four shortcuts. Change them, or add one for "Copy results as a list", on the
browser's extension shortcuts page (`chrome://extensions/shortcuts`).

## Install

From the [Chrome Web Store](https://chromewebstore.google.com/detail/ticket-kit/pgjdhibiaciajnapbghgipafjdobmikj).
Bugs and ideas: [open an issue](https://github.com/lodovicoazzini/ticket-kit/issues).

From source:

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that holds `manifest.json`.
4. Pin Ticket Kit from the puzzle icon in the toolbar.

### In Dia

Dia doesn't deliver browser-scoped extension shortcuts. On its extension shortcuts page, set each Ticket Kit shortcut's
scope to **Global** and pick combinations no other app uses. A global shortcut also works while another app is in front;
it then acts on the active tab of the Dia window you used last.

## Settings

Right-click the toolbar icon and pick **Options**. Settings sync with your browser profile.

**Link formats.** Templates with these placeholders: `{key}`, `{summary}`, `{url}`, `{type}`, `{status}`, `{project}`.

| Setting | Default |
|---|---|
| Link text | `{key} - {summary}` |
| Plain-text version | `{key} - {summary}` |
| Copy as Markdown | `[{key} - {summary}]({url})` |
| Copy URL | `{url}` |

**Branch names.** One rule per line, `Issue type = prefix`, plus a prefix for every other type. Leave a prefix empty for
branch names without one. Defaults: `Bug = bugfix`, everything else `feature`. A team that uses `fix/` and `chore/`
might write:

```
Bug = fix
Task = chore
Spike =
```

**Jira site.** Your Jira Cloud address, like `your-team.atlassian.net`. Ticket Kit fills it in the first time you use it
on a Jira tab. It's used where there's no Jira tab to go by: "Open in Jira" on selected text, the `j` keyword, and ticket
search in the menu.

## Privacy and permissions

Ticket Kit talks only to your Jira site, from your browser, with the login you already have. It has no server, sends
nothing anywhere else and collects no analytics. See [store/privacy-policy.md](store/privacy-policy.md).

| Permission | Why |
|---|---|
| `https://*.atlassian.net/*` | Read the ticket from your Jira site, also when a global shortcut arrives without tab access. |
| `activeTab` | Read the current tab's address after you press a shortcut, click the icon or use a menu entry. |
| `scripting` | Run the ticket lookup and the notice in that tab. |
| `contextMenus` | The right-click entries. |
| `offscreen`, `clipboardWrite` | A hidden page writes to the clipboard, because the service worker has no DOM. |
| `storage` | Your settings. |

There is no content script: nothing runs on a page until you use the extension there.

## How it works

- The ticket key comes from the tab address (`/browse/KEY`, `/jira/browse/KEY`, `?selectedIssue=KEY`) or from the
  right-clicked link.
- Every Jira call runs inside a Jira tab, as a same-origin request with your session cookie, so no API token is needed:
  `/rest/api/3/issue/{key}` for ticket details, `/rest/api/3/search/jql` for lists, `/rest/api/3/issue/picker` for
  ticket search. If the ticket call fails, the summary comes from the tab title or the page heading.
- Branches and pull requests come from the data behind Jira's Development panel, `/rest/dev-status/latest/issue/detail`.
  Atlassian doesn't document that endpoint. If it changes, those two actions show an error and the rest keeps working.
- Jira's built-in filters (negative ids) don't share their JQL, so for those the extension asks you to run the search first.
- The menu is `menu.html`, shown in a frame over the page. While it's open, keys pressed on the page don't reach Jira,
  so a fast typist doesn't trigger Jira's single-key shortcuts. On pages the extension can't run in it opens as a
  small window instead.
- With no Jira tab open, ticket suggestions in the address bar call Jira from the service worker. That only works when
  the browser sends your Jira login with extension requests.

## Development

```sh
npm test              # unit tests, Node 20 or later, no dependencies
npm run package       # dist/ticket-kit-<version>.zip for the Web Store
npm run screenshots   # store images into store/images/ (needs Google Chrome and python3)
python3 tools/make-icons.py   # redraw the icons
```

After changing the code, click the reload arrow on the extension's card in `chrome://extensions`.

Manual checks before a release, on a Jira Cloud site of your own:

- [ ] On a ticket, Alt+Shift+J copies the link. Pasted into a rich editor it's a link; into a terminal it's text.
- [ ] Right-click the icon: Copy as Markdown escapes brackets in the summary; Copy URL gives `/browse/KEY`.
- [ ] Alt+Shift+K opens the menu; typing filters it; Escape closes it; Alt+Shift+K again closes it too.
- [ ] Alt+Shift+B copies a branch name with the prefix your rules give that issue type. The menu lists the other prefixes and existing branches; Alt+Enter copies the git command.
- [ ] Alt+Shift+P opens the only open pull request, or the list. A ticket without pull requests shows "No pull request linked".
- [ ] On a search, Copy results as a list copies the tickets in screen order. Off a search, the menu has no "This search" group.
- [ ] Select a key on another site, right-click, Open in Jira opens it. Two keys open one search.
- [ ] `j KEY` in the address bar opens the ticket; `j some words` suggests tickets.
- [ ] In a fresh profile, Options shows the Jira site as not set, and it fills in after the first use on a Jira tab.
- [ ] On `chrome://extensions`, Alt+Shift+K opens the menu as a small window; other shortcuts show a red badge.

## Publishing

`store/listing.md` has every field of the Chrome Web Store dashboard ready to paste. Raise `version` in `manifest.json`,
run `npm test` and `npm run package`, and upload the zip.

## Files

| Path | What it holds |
|---|---|
| `manifest.json` | Permissions, shortcuts, address bar keyword, icons. |
| `background.js` | Service worker: shortcuts, icon click, right-click menus, address bar keyword, the menu's requests, clipboard, badge. |
| `menu.html`, `menu.js`, `menu.css` | The action menu. |
| `lib/format.js` | Key detection, templates, escaping, branch names, lists. Pure, tested with Node. |
| `lib/inject.js` | Code that runs inside the Jira tab: ticket lookup, Development panel, search, ticket picker, selection, notice, menu frame. |
| `offscreen.html`, `offscreen.js` | Writes to the clipboard. |
| `options.html`, `options.js`, `options.css` | Settings page. |
| `icons/` | Toolbar icons, drawn by `tools/make-icons.py`. |
| `test/` | Unit tests. |
| `tools/package.sh`, `tools/screenshots.sh` | Build the store zip and the store images. |
| `store/` | Store texts, privacy policy, images and the pages they're rendered from. |

## License

MIT, see [LICENSE](LICENSE).

Ticket Kit is not made by or affiliated with Atlassian. Jira is a trademark of Atlassian.
