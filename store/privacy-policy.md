# Ticket Kit privacy policy

Last updated: 17 November 2026

Ticket Kit is a browser extension for working with Jira tickets. This page says what data it touches and where that data goes.

## What Ticket Kit reads

When you use one of its actions, Ticket Kit reads from your own Jira Cloud site (an address ending in `atlassian.net`):

- the key, summary, issue type, status and project of a ticket
- the tickets returned by a Jira search you have open
- the branches and pull requests Jira lists for a ticket
- tickets matching words you type into its menu or the address bar
- the text you have selected, when you open the menu or pick "Open in Jira"

It reads this through your browser, with the Jira login you already have. It never sees or stores your password.

## Where that data goes

- **Your clipboard.** Links, branch names and lists you copy go to your clipboard and nowhere else.
- **Your browser tabs.** Tickets, searches and pull requests you open, open in your browser.
- **Your settings.** Your link templates, your branch prefix rules and your Jira site address are saved with the browser's extension storage. If you have browser sync turned on, the browser syncs them across your devices.

Ticket Kit has no server. It does not send any data to its developer or to anyone else, it uses no analytics or tracking, and it loads no code from the internet.

## Permissions

Ticket Kit can read pages on `atlassian.net` and, after you press one of its shortcuts or use one of its menus, the tab you are on. It uses this only for the actions above.

## Changes

If this policy changes, the date at the top changes with it.

## Contact

Questions about this policy, or about Ticket Kit in general: open an issue at https://github.com/lodovicoazzini/ticket-kit/issues.
