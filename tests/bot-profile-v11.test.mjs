import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardConnectionId, isGenericProfileName } from '../src/worker-v11.js';

test('reads bot connection id from dashboard query string', () => {
  const request = new Request('https://bot.jean1331.io.vn/admin/dashboard-data?connection_id=bot-buns-ca-s-a');
  assert.equal(getDashboardConnectionId(request), 'bot-buns-ca-s-a');
});

test('falls back to dashboard referrer connection id', () => {
  const request = new Request('https://bot.jean1331.io.vn/admin/bot-profile', {
    headers: { referer: 'https://dashboard.jean1331.io.vn/?connection_id=bot-buns-ca-s-a' }
  });
  assert.equal(getDashboardConnectionId(request), 'bot-buns-ca-s-a');
});

test('detects only the old generic bot profile name', () => {
  assert.equal(isGenericProfileName('Bot Thu Thập atess'), true);
  assert.equal(isGenericProfileName('Bot Thu Thap atess'), true);
  assert.equal(isGenericProfileName('Thảo Vy'), false);
});
