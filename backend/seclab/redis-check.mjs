// Health check for REDIS_URL, in the SAME ORDER production runs it:
//   1. create store + init() immediately (TLS still connecting, isReady=false)
//   2. wait for the socket
//   3. increment
// Step 1 is the exact sequence that 500'd every request before the fix
// (redisClient.js init() dropped the options when !isReady -> windowMs undefined).
// Run it twice: shared counter must go 1 -> 2 across separate processes.
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.REDIS_URL) {
  console.log('❌ REDIS_URL not set in backend/.env');
  process.exit(1);
}
console.log('REDIS_URL =', process.env.REDIS_URL.replace(/^(rediss?:\/\/)[^@]*@/, '$1***@'));

const { getRedisClient, createRateLimitStore, consumeOnce } = await import('../utils/redisClient.js');

const client = getRedisClient();

// 1) init() FIRST, while the socket is still connecting (production order)
const store = createRateLimitStore('rl:check');
const initResult = store.init({ windowMs: 15 * 60 * 1000 });
console.log('init() called while isReady=' + client.isReady + ' ->', initResult === undefined ? 'deferred (ok)' : 'started');

// 2) wait for readiness
for (let i = 0; i < 300 && !client.isReady; i++) await new Promise(r => setTimeout(r, 100));
if (!client.isReady) {
  console.log('❌ Redis NOT ready after 30s');
  process.exit(1);
}
console.log('✅ Redis connected, PING ->', await client.ping());

// 3) first increment - this is what threw "reading 'toString'" pre-fix
const a = await store.increment('shared-check-key');
console.log(`  counter: ${a.totalHits} (reset in ${a.resetTime - Date.now()}ms)`);

// 4) OAuth one-time token (this threw "setNx is not a function" pre-fix).
// NOTE: `first` may legitimately be false on a later run — that means a
// PREVIOUS process already consumed it, i.e. the token is durable across
// processes. That is the desired behaviour (pre-fix it would be true again,
// because the fallback set lived in per-instance memory).
const first = await consumeOnce('check-once-token', 60);
const second = await consumeOnce('check-once-token', 60);
const ok = typeof first === 'boolean' && typeof second === 'boolean' && second === false;
console.log(
  `  consumeOnce first=${first} second=${second} ${ok ? '✅' : '❌'} ` +
    (first === false ? '(already consumed by a previous process = durable ✅)' : '(freshly consumed this run)')
);

await client.quit();
if (!ok) process.exit(1);
console.log('done');
