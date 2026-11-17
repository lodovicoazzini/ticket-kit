# Chrome Web Store listing: Ticket Kit

Text to paste into the Chrome Web Store developer dashboard, field by field.
Images are in `store/images/`. Rebuild them with `npm run screenshots`, rebuild the upload zip with `npm run package`.

## Store listing tab

**Name** (from the manifest): Ticket Kit

**Summary** (from the manifest description, 132 characters at most):

> Copies Jira tickets as links, copies branch names and search results, and opens tickets and pull requests.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Ticket Kit puts the things you do with a Jira ticket on one shortcut.

Press Alt+Shift+K on a Jira ticket and a menu opens over the page. Type a few letters to find an action, or type a ticket key to open that ticket.

COPY
• Copy the ticket as a link named "PAY-1284 - Summary". Teams, Outlook, Slack and Confluence paste it as a clickable title; terminals and commit dialogs get the plain text.
• Copy as Markdown or as the bare URL.
• Copy a whole Jira search or saved filter as a bulleted list of links, up to 100 tickets.
• Copy a branch name built from the ticket, like bugfix/PAY-1284-refund-export-skips-orders. You set the prefix per issue type (bugfix, fix, chore, none), and the branches already linked in Jira are one keystroke away. Alt+Enter copies the git switch command instead.

OPEN
• Open the ticket's pull request. With one open pull request it opens straight away; otherwise pick from the list.
• Select a ticket key on any page, right-click, and choose "Open in Jira".
• Type j and a space in the address bar, then a key or a few words, to open or find a ticket.

SHORTCUTS
Alt+Shift+K opens the menu, Alt+Shift+J copies the link, Alt+Shift+B copies a branch name, Alt+Shift+P opens the pull request. Change them on the browser's extension shortcuts page.

SETTINGS
The link text, the plain-text version and the Markdown format are templates you can change, with placeholders for key, summary, URL, type, status and project. Branch prefixes are set per issue type. Your Jira site is detected the first time you use Ticket Kit on it.

PRIVACY
Ticket Kit talks only to your own Jira site, from your browser, with your existing login. It has no server, sends nothing to its developer or anyone else, and collects no analytics. It works with Jira Cloud sites on atlassian.net. Self-hosted Jira Server and Data Center are not supported.

Ticket Kit is not made by or affiliated with Atlassian. Jira is a trademark of Atlassian.
```

**Images:**

| Field | File |
|---|---|
| Store icon (128x128) | `icons/icon128.png` |
| Screenshots (1280x800) | `store/images/screenshot-1.png` to `screenshot-5.png` |
| Small promo tile (440x280) | `store/images/promo-small.png` |

**Visibility** (Distribution tab): Public, free, all regions.

**Support URL** (Additional fields): https://github.com/lodovicoazzini/ticket-kit/issues

**Homepage URL** (Additional fields): https://github.com/lodovicoazzini/ticket-kit

## Privacy practices tab

**Single purpose:**

> Ticket Kit speeds up everyday work with Jira tickets: it copies a ticket's link, branch name or a search's ticket list to the clipboard, and opens tickets and their pull requests.

**Permission justifications:**

| Permission | Justification |
|---|---|
| activeTab | Reads the URL of the current tab to find the Jira ticket key, and runs the ticket lookup there, only after the user presses a shortcut, clicks the icon or picks a menu entry. |
| scripting | Runs the ticket lookup, the Jira search and the confirmation notice inside the Jira tab the user is on. |
| contextMenus | Adds "Copy Jira link" on ticket links, "Open in Jira" on selected text, and two copy formats on the toolbar icon. |
| offscreen | A hidden page writes the copied link to the clipboard, because the service worker has no DOM. |
| clipboardWrite | Lets that hidden page write the link, as rich text and plain text, to the clipboard. |
| storage | Saves the user's link templates, branch prefix rules and Jira site address, synced through their browser profile. |
| Host permission `https://*.atlassian.net/*` | Reads the ticket from the user's own Jira Cloud site when a shortcut arrives without tab access (global shortcuts), and runs ticket search for the menu and the address bar keyword. No other site is accessed. |

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage.** Tick these categories:

- **Website content.** The extension reads ticket keys, summaries, issue types, statuses, branch names and pull request titles from the user's Jira site to build what it copies.

Leave every other category unticked. The extension handles no personally identifiable information, health, financial, authentication, personal communications, location, web history or user activity data. Ticket summaries can contain names when users write them there; that text only goes to the user's own clipboard.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/lodovicoazzini/ticket-kit/blob/main/store/privacy-policy.md

## Before you submit

- [ ] Open the privacy policy URL above in a private window to check it loads without logging in.
- [ ] Register the developer account with your personal Google account at `chrome.google.com/webstore/devconsole`.
      Google charges a one-time fee of 5 US dollars and requires 2-step verification.
- [ ] Trader declaration (EU rules): a free extension published by a private person is usually "non-trader". A trader's
      name, address, phone and email are shown on the listing; a non-trader's are not.
- [ ] Set a publisher display name and verify the contact email in the account settings.
- [ ] Check that your employment contract lets you publish something you built at work under your own name.
- [ ] `npm test`, then `npm run package`, and upload `dist/ticket-kit-<version>.zip`.
- [ ] For each update, raise `version` in `manifest.json` before packaging. The store rejects a version it has already seen.
