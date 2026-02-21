'use strict';

/**
 * One-time Plaid Link setup script.
 * Run with: npm run link
 *
 * Flow:
 *  1. Creates a Plaid link_token via the API
 *  2. Serves a local HTML page that opens the Plaid Link widget
 *  3. Opens your browser automatically
 *  4. After you complete Link, exchanges public_token → access_token
 *  5. Saves all linked accounts + access_token to the DB
 *  6. Prints a summary and exits
 */

require('dotenv').config();

const http = require('http');
const { exec } = require('child_process');
const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');
const db = require('../src/db');

const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV = 'sandbox' } = process.env;

if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
  console.error('Error: PLAID_CLIENT_ID and PLAID_SECRET must be set in .env');
  process.exit(1);
}

const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
        'PLAID-SECRET': PLAID_SECRET,
      },
    },
  })
);

const PORT = 3001;

// ---------------------------------------------------------------------------
// HTML served to the browser — loads Plaid Link JS and handles the flow
// ---------------------------------------------------------------------------
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Link Bank Account — money-mgmt</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f0f2f5;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
      padding: 2.5rem 2rem;
      text-align: center;
      width: 360px;
    }
    h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
    p  { color: #555; margin: 0 0 1.5rem; font-size: 0.95rem; }
    button {
      background: #00a551;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      cursor: pointer;
      width: 100%;
    }
    button:disabled { background: #ccc; cursor: not-allowed; }
    #status { margin-top: 1rem; font-size: 0.9rem; color: #444; min-height: 1.2em; }
    .success { color: #00a551; font-weight: 600; }
    .error   { color: #d32f2f; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Link Bank Account</h1>
    <p>Securely connect your bank or credit card via Plaid (${PLAID_ENV} environment).</p>
    <button id="btn" disabled>Loading…</button>
    <div id="status"></div>
  </div>

  <script>
    const btn    = document.getElementById('btn');
    const status = document.getElementById('status');

    async function init() {
      const res = await fetch('/create-link-token');
      if (!res.ok) throw new Error('Failed to create link token');
      const { link_token } = await res.json();

      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          btn.disabled = true;
          status.textContent = 'Exchanging token and saving accounts…';
          status.className = '';

          const resp = await fetch('/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token }),
          });
          const result = await resp.json();

          if (result.ok) {
            status.textContent = 'Accounts linked! You can close this tab.';
            status.className = 'success';
          } else {
            status.textContent = 'Error: ' + result.error;
            status.className = 'error';
            btn.disabled = false;
          }
        },
        onExit: (err) => {
          if (err) {
            status.textContent = err.display_message || err.error_message || 'Exited with error';
            status.className = 'error';
          }
        },
      });

      btn.disabled = false;
      btn.textContent = 'Connect Bank Account';
      btn.onclick = () => handler.open();
    }

    init().catch((err) => {
      status.textContent = 'Failed to load: ' + err.message;
      status.className = 'error';
    });
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------
async function handleCreateLinkToken(res) {
  const { data } = await plaid.linkTokenCreate({
    user: { client_user_id: 'local-setup-user' },
    client_name: 'money-mgmt',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ link_token: data.link_token }));
}

async function handleExchange(body, res, server) {
  const { public_token } = JSON.parse(body);

  // Exchange public_token → access_token + item_id
  const { data: tokenData } = await plaid.itemPublicTokenExchange({ public_token });
  const { access_token, item_id } = tokenData;

  // Fetch the linked accounts
  const { data: accountsData } = await plaid.accountsGet({ access_token });
  const { accounts } = accountsData;

  // Persist to DB
  const insert = db.prepare(`
    INSERT OR IGNORE INTO accounts
      (plaid_account_id, plaid_item_id, access_token, name, official_name, type, subtype, mask)
    VALUES
      (@plaid_account_id, @plaid_item_id, @access_token, @name, @official_name, @type, @subtype, @mask)
  `);

  db.transaction(() => {
    for (const acc of accounts) {
      insert.run({
        plaid_account_id: acc.account_id,
        plaid_item_id:    item_id,
        access_token,
        name:             acc.name,
        official_name:    acc.official_name || null,
        type:             acc.type,
        subtype:          acc.subtype || null,
        mask:             acc.mask || null,
      });
    }
  })();

  // Print summary
  console.log('\nLinked accounts:');
  for (const acc of accounts) {
    const mask = acc.mask ? `****${acc.mask}` : '(no mask)';
    console.log(`  ${acc.name} — ${acc.type}/${acc.subtype} ${mask}`);
  }
  console.log(`\nitem_id:      ${item_id}`);
  console.log('access_token: saved to DB (accounts table)');
  console.log('\nAll done. You can close the browser tab.\n');

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));

  // Give the browser time to render the success message before exiting
  setTimeout(() => {
    server.close();
    db.close();
    process.exit(0);
  }, 1500);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const send500 = (err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  };

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && req.url === '/create-link-token') {
    handleCreateLinkToken(res).catch(send500);
    return;
  }

  if (req.method === 'POST' && req.url === '/exchange') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => handleExchange(body, res, server).catch(send500));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nPlaid Link server running at ${url}`);
  console.log(`Environment: ${PLAID_ENV}`);
  console.log('Opening browser…\n');
  exec(`open "${url}"`);
});
