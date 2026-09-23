/**
 * Phase 3 Google Calendar Slice 1 — connection/OAuth/encryption checks.
 * Does not call live Google or apply v13.
 */
import assert from 'assert';
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  CalendarCryptoError,
  decryptSecret,
  encryptSecret,
  loadGoogleTokenEncryptionKey,
  parseGoogleTokenEncryptionKey,
} from '../../lib/calendar/crypto';
import {
  bindOAuthCallback,
  createOAuthHandshake,
  generatePkceVerifier,
  isUuid,
  parseOAuthHandshake,
  pkceChallengeS256,
  serializeOAuthHandshake,
} from '../../lib/calendar/oauth';

const root = process.cwd();
const testKey = Buffer.alloc(32, 9).toString('base64');
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = testKey;

assert.equal(parseGoogleTokenEncryptionKey(undefined), null);
assert.equal(parseGoogleTokenEncryptionKey('short'), null);
assert.equal(loadGoogleTokenEncryptionKey(testKey).length, 32);

const roundTrip = encryptSecret('refresh-token-value');
assert.match(roundTrip, /^v1\./);
assert.equal(decryptSecret(roundTrip), 'refresh-token-value');
assert.notEqual(roundTrip, encryptSecret('refresh-token-value'));

assert.throws(() => decryptSecret('not-ciphertext'), CalendarCryptoError);
assert.throws(() => decryptSecret('v2.a.b.c'), CalendarCryptoError);
assert.throws(() => decryptSecret('v1.aaaa.bbbb.cccc'), CalendarCryptoError);

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const handshake = createOAuthHandshake(userA);
assert.equal(handshake.userId, userA);
assert.equal(pkceChallengeS256(handshake.codeVerifier), createHash('sha256').update(handshake.codeVerifier).digest('base64url'));
const verifier = generatePkceVerifier();
assert.ok(verifier.length >= 32);
assert.notEqual(pkceChallengeS256(verifier), verifier);

const cookie = serializeOAuthHandshake(handshake);
const parsed = parseOAuthHandshake(cookie);
assert.ok(parsed);
assert.equal(parsed!.userId, userA);
assert.equal(parsed!.nonce, handshake.nonce);

const bound = bindOAuthCallback({
  handshake: parsed,
  returnedState: handshake.nonce,
});
assert.equal(bound.ok, true);
if (bound.ok) assert.equal(bound.handshake.userId, userA);

const mismatchedState = bindOAuthCallback({
  handshake: parsed,
  returnedState: 'other-state',
});
assert.equal(mismatchedState.ok, false);

const missingCookie = bindOAuthCallback({
  handshake: null,
  returnedState: handshake.nonce,
});
assert.equal(missingCookie.ok, false);

const otherUserHandshake = { ...handshake, userId: userB };
const swapped = bindOAuthCallback({
  handshake: otherUserHandshake,
  returnedState: handshake.nonce,
});
assert.equal(swapped.ok, true);
if (swapped.ok) {
  assert.equal(swapped.handshake.userId, userB);
  assert.notEqual(swapped.handshake.userId, userA);
}

assert.equal(isUuid('not-a-user'), false);
assert.throws(() => createOAuthHandshake('browser-supplied'));

const v13 = readFileSync(
  join(root, 'supabase/v13_google_calendar_projection.sql'),
  'utf8'
);
const v13c = v13.replace(/\s+/g, ' ').toLowerCase();
assert.ok(v13.includes('google_calendar_connections'));
assert.ok(v13.includes('google_calendar_event_links'));
assert.ok(v13.includes('refresh_token_ciphertext'));
assert.ok(v13.includes('sync_enabled boolean not null default false'));
assert.ok(v13.includes('on delete cascade'));
assert.ok(v13c.includes('revoke all on table public.google_calendar_connections from anon, authenticated, public'));
assert.ok(v13c.includes('revoke all on table public.google_calendar_event_links from anon, authenticated, public'));
assert.ok(!v13c.includes('grant select'));
assert.ok(!v13c.includes('grant insert'));
assert.ok(v13.includes('using (false)'));
assert.ok(v13.includes('google_calendar_connections_deny_all'));
assert.ok(!v13.includes('alter table public.planned_occurrences'));
assert.ok(!v13.includes('alter table public.logs'));
assert.ok(!v13.includes('Do not apply') || v13.includes('Do not apply to live'));

const v8 = readFileSync(join(root, 'supabase/v8_planning_contract.sql'), 'utf8');
assert.ok(!v8.toLowerCase().includes('google_calendar'));

const planningDir = join(root, 'lib/planning');
const planningBundle = readdirSync(planningDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(planningDir, name), 'utf8'))
  .join('\n');
assert.ok(!planningBundle.includes('lib/calendar'));
assert.ok(!planningBundle.includes('google_calendar'));
assert.ok(!planningBundle.includes('GOOGLE_CALENDAR'));
assert.ok(
  !readFileSync(join(root, 'lib/evaluation/developmentalGate.ts'), 'utf8').includes(
    'lib/calendar'
  )
);

const calendarDir = join(root, 'lib/calendar');
const calendarBundle = readdirSync(calendarDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(calendarDir, name), 'utf8'))
  .join('\n');
assert.ok(!calendarBundle.includes("from 'googleapis'"));
assert.ok(!calendarBundle.includes('require("googleapis")'));
assert.ok(!calendarBundle.includes('/calendar/v3/'));
assert.ok(!calendarBundle.includes('events.insert'));
assert.ok(!calendarBundle.includes('lib/evaluation'));
assert.ok(!calendarBundle.includes("from '../planning"));
assert.ok(!calendarBundle.includes("from '../../planning"));
assert.ok(!calendarBundle.includes("from 'lib/planning"));
assert.ok(calendarBundle.includes('calendar.events'));
assert.ok(calendarBundle.includes('calendar.calendarlist.readonly'));

const callback = readFileSync(
  join(root, 'app/api/calendar/google/callback/route.ts'),
  'utf8'
);
assert.ok(callback.includes('bindOAuthCallback'));
assert.ok(callback.includes('parseOAuthHandshake'));
assert.ok(!callback.includes("searchParams.get('user_id')"));
assert.ok(!callback.includes('searchParams.get("user_id")'));
assert.ok(!callback.includes('/calendar/v3/'));
assert.ok(!callback.includes('events.insert'));
assert.ok(callback.includes('tokens.refresh_token'));
assert.ok(callback.includes('existing?.refresh_token_ciphertext'));

const start = readFileSync(
  join(root, 'app/api/calendar/google/start/route.ts'),
  'utf8'
);
assert.ok(start.includes('calendarUserFromBearer'));
assert.ok(start.includes('code_challenge_method') || start.includes('pkceChallengeS256'));
assert.ok(start.includes('OAUTH_COOKIE_NAME'));

const disconnect = readFileSync(
  join(root, 'app/api/calendar/disconnect/route.ts'),
  'utf8'
);
assert.ok(disconnect.includes('revokeGoogleToken'));
assert.ok(disconnect.includes('deleteCalendarConnection'));
assert.ok(!disconnect.includes('from(\'goals\')'));
assert.ok(!disconnect.includes('planned_occurrences'));

const deleteAccount = readFileSync(
  join(root, 'app/api/delete-account/route.ts'),
  'utf8'
);
assert.ok(deleteAccount.includes('revokeGoogleToken'));
assert.ok(deleteAccount.includes('Continue deleting the Bettr account'));

const envExample = readFileSync(join(root, '.env.local.example'), 'utf8');
assert.ok(envExample.includes('GOOGLE_CALENDAR_CLIENT_ID'));
assert.ok(envExample.includes('GOOGLE_CALENDAR_CLIENT_SECRET'));
assert.ok(envExample.includes('GOOGLE_CALENDAR_REDIRECT_URI'));
assert.ok(envExample.includes('GOOGLE_TOKEN_ENCRYPTION_KEY'));
assert.ok(!envExample.includes('sk-'));
assert.ok(!/GOOGLE_CALENDAR_CLIENT_SECRET=.+./.test(envExample.split('\n').find((line) => line.startsWith('GOOGLE_CALENDAR_CLIENT_SECRET')) || ''));

const ui = readFileSync(join(root, 'app/calendar/GoogleCalendarSettings.tsx'), 'utf8');
assert.ok(ui.includes('Connect Google Calendar'));
assert.ok(ui.includes('Disconnect'));
assert.ok(ui.includes('Sync: Off'));
assert.ok(!ui.includes('Sync now'));

console.log(
  JSON.stringify(
    {
      ok: true,
      slice: 'calendar-1',
      migration: 'v13_google_calendar_projection.sql',
      applied: false,
      events: false,
    },
    null,
    2
  )
);
