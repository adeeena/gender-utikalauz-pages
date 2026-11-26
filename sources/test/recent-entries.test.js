const assert = require('node:assert/strict');
const test = require('node:test');
const { listRecentlyModified } = require('../seo');

test('lists only entries modified in the last 120 days, newest first', () => {
  const entries = listRecentlyModified('hu', 120, new Date('2026-11-25T12:00:00Z'));

  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.dateModified === '2026-11-25'));
  assert.ok(entries.every((entry) => entry.slug && entry.title));

  const timestamps = entries.map((entry) => new Date(`${entry.dateModified}T00:00:00Z`).getTime());
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => b - a));
});
