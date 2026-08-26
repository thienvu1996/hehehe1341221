import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExplicitMention, isGroupMessage, isPassiveGroupMessage } from '../src/worker-v12.js';

test('detects Zalo group messages', () => {
  assert.equal(isGroupMessage({ chat: { chat_type: 'GROUP' } }), true);
  assert.equal(isGroupMessage({ chat: { chat_type: 'PRIVATE' } }), false);
});

test('detects explicit mentions from text or mention metadata', () => {
  assert.equal(hasExplicitMention({ text: '@Bot test hello' }), true);
  assert.equal(hasExplicitMention({ text: 'hello', mentions: [{ id: 'bot' }] }), true);
  assert.equal(hasExplicitMention({ text: 'hello' }), false);
});

test('marks delivered non-mentioned group messages as passive capture', () => {
  const message = { chat: { chat_type: 'GROUP' }, text: 'căn này 8tr q7' };
  assert.equal(isPassiveGroupMessage('message.text.received', message), true);
  assert.equal(isPassiveGroupMessage('message.image.received', message), true);
  assert.equal(isPassiveGroupMessage('message.text.received', { ...message, text: '@Bot căn này 8tr q7' }), false);
});
