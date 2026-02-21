'use strict';

require('dotenv').config();

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV = 'sandbox' } = process.env;

if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
  throw new Error('Missing required env vars: PLAID_CLIENT_ID, PLAID_SECRET');
}

const client = new PlaidApi(
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

/**
 * Fetch all linked accounts for a given access token.
 * @param {string} accessToken
 * @returns {Promise<Array>}
 */
async function getAccounts(accessToken) {
  const { data } = await client.accountsGet({ access_token: accessToken });
  return data.accounts;
}

/**
 * Fetch transactions posted in the past 24 hours for a given access token.
 * @param {string} accessToken
 * @returns {Promise<Array>}
 */
async function getRecentTransactions(accessToken) {
  const now = new Date();
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);

  const fmt = (d) => d.toISOString().split('T')[0];

  const { data } = await client.transactionsGet({
    access_token: accessToken,
    start_date: fmt(yesterday),
    end_date: fmt(now),
    options: { count: 500, offset: 0 },
  });

  return data.transactions;
}

/**
 * Fetch current balances for all linked accounts.
 * @param {string} accessToken
 * @returns {Promise<Array>}
 */
async function getBalances(accessToken) {
  const { data } = await client.accountsBalanceGet({ access_token: accessToken });
  return data.accounts;
}

module.exports = { getAccounts, getRecentTransactions, getBalances };
