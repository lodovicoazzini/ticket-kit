// Stand-in for the extension APIs, so the real menu.js can render store screenshots outside the
// extension. All tickets, branches and pull requests here are made up.
(function () {
  const scene = new URLSearchParams(location.search).get('scene') || 'menu';
  const KEY = 'PAY-1284';
  const SUMMARY = 'Refund export skips orders with an ampersand in the customer name';
  const URL_ = `https://your-team.atlassian.net/browse/${KEY}`;

  const context = {
    ok: true,
    host: 'your-team.atlassian.net',
    key: KEY,
    ticket: {
      summary: SUMMARY,
      type: 'Bug',
      link: `${KEY} - ${SUMMARY}`,
      markdown: `[${KEY} - ${SUMMARY}](${URL_})`,
      url: URL_,
      branch: 'bugfix/PAY-1284-refund-export-skips-orders-with-an',
    },
    search: null,
    selectionKeys: [],
  };

  const pullRequests = [
    { id: '931', status: 'OPEN', name: 'PAY-1284: Escape ampersands in the refund export', url: 'https://example.com/931',
      source: 'bugfix/PAY-1284-refund-export-skips-orders-with-an', dest: 'main', repo: 'shop/payments', updated: '2026-11-16T15:10:00Z' },
    { id: '934', status: 'OPEN', name: 'PAY-1284: Backport the export fix to release/4.2', url: 'https://example.com/934',
      source: 'bugfix/PAY-1284-backport-4.2', dest: 'release/4.2', repo: 'shop/payments', updated: '2026-11-16T16:40:00Z' },
    { id: '918', status: 'MERGED', name: 'PAY-1284: Add a failing test for names with &', url: 'https://example.com/918',
      source: 'bugfix/PAY-1284-failing-test', dest: 'main', repo: 'shop/payments', updated: '2026-11-14T09:05:00Z' },
    { id: '912', status: 'DECLINED', name: 'PAY-1284: Strip special characters from customer names', url: 'https://example.com/912',
      source: 'bugfix/PAY-1284-strip-names', dest: 'main', repo: 'shop/payments', updated: '2026-11-13T11:20:00Z' },
  ];

  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'menu:context') return context;
        if (msg.type === 'menu:branches') {
          return {
            ok: true, key: KEY, type: 'Bug',
            fresh: ['bugfix/PAY-1284-refund-export-skips-orders-with-an', 'feature/PAY-1284-refund-export-skips-orders-with-an'],
            existing: [
              { name: 'bugfix/PAY-1284-backport-4.2', repo: 'shop/payments' },
              { name: 'bugfix/PAY-1284-failing-test', repo: 'shop/payments' },
            ],
            existingError: null,
          };
        }
        if (msg.type === 'menu:prs') return { ok: true, key: KEY, items: pullRequests };
        if (msg.type === 'menu:picker') return { ok: true, items: [] };
        return { ok: true };
      },
    },
    commands: {
      getAll: async () => [
        { name: 'open-menu', shortcut: '⌥⇧K' }, { name: 'copy-link', shortcut: '⌥⇧J' },
        { name: 'copy-branch', shortcut: '⌥⇧B' }, { name: 'open-pr', shortcut: '⌥⇧P' }, { name: 'copy-list', shortcut: '' },
      ],
    },
  };

  // The menu scene shows a typed filter, like a user narrowing the list.
  if (scene === 'filter') {
    window.addEventListener('load', () => setTimeout(() => {
      const q = document.getElementById('q');
      q.value = 'copy';
      q.dispatchEvent(new Event('input'));
    }, 200));
  }
}());
