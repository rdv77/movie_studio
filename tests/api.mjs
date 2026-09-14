import { strict as assert } from 'node:assert';
const origin = process.env.TEST_ORIGIN;
const username = process.env.TEST_USERNAME;
const password = process.env.TEST_PASSWORD;
assert(origin && username && password, 'Run tests/server-smoke.mjs, or set TEST_ORIGIN, TEST_USERNAME and TEST_PASSWORD for an isolated test server.');
const target = new URL(origin);
assert(target.origin === origin && target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'HTTP tests require an explicit local test server.');
const login = await fetch(origin + '/api/auth/login', {
  method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username, password }), signal: AbortSignal.timeout(30000),
});
assert.equal(login.status, 303, 'Test-owner login must succeed.');
assert.equal(login.headers.get('location'), origin + '/');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert(cookie?.startsWith('kadr_session='), 'Login must issue the signed session cookie.');
const auth = { cookie, origin };
async function req(path, method = 'GET', body, expected = 200) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      ...auth,
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d;
}
assert.equal((await fetch(origin + '/api/projects')).status, 401);
const initialConnections = await req('/api/connections');
assert(initialConnections.providers.every((provider) => !provider.configured), 'Domain tests require an empty test credential vault; aborting before any generation action.');
let p = await req(
  '/api/projects',
  'POST',
  { title: 'Проверка API — временный проект' },
  201,
);
const pid = p.id;
const path = '/api/projects/' + pid;
async function act(
  action,
  data,
  item = p.items[0].id,
  expected = 200,
  revision = p.revision,
) {
  const r = await req(
    path,
    'PATCH',
    { revision, action, itemId: item, data },
    expected,
  );
  if (expected === 200) p = r;
  return r;
}
await act(
  'addVariant',
  { title: 'Рано', text: 'Нельзя пропустить сценарий', kind: 'text' },
  p.items[1].id,
  400,
);
await act('addVariant', {
  title: 'Сценарий A',
  text: 'Вечером девочка возвращает свет погасшему городу.',
  kind: 'text',
});
const firstId = p.items[0].selectedId;
assert.equal(p.items[0].approvedId, undefined);
await act('approve');
assert.equal(p.items[0].approvedId, firstId);
await act(
  'addVariant',
  { title: 'Героиня', text: 'Лена, любопытная и упрямая.', kind: 'text' },
  p.items[1].id,
);
await act('approve', undefined, p.items[1].id);
const before = p.revision;
await act('addVariant', {
  title: 'Сценарий B',
  text: 'Вместо города — маленькая станция.',
  kind: 'text',
});
assert.equal(p.items[0].approvedId, firstId);
await act('approve');
await act('approve', undefined, p.items[1].id, 400);
await act('renameItem', { title: 'Конфликт' }, p.items[0].id, 400, before);
const bad = await fetch(origin + path, {
  method: 'PATCH',
  headers: {
    ...auth,
    origin: 'https://unexpected.example',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    revision: p.revision,
    action: 'approve',
    itemId: p.items[0].id,
  }),
});
assert.equal(bad.status, 403);
const generation = await req(
  path + '/generate',
  'POST',
  {
    revision: p.revision,
    batchId: crypto.randomUUID(),
    itemId: p.items[0].id,
    models: ['grok-4.6'],
    count: 1,
    prompt: 'Доработай',
    refs: [],
    dialogue: '',
    voiceId: '',
    estimates: {},
  },
  400,
);
assert(generation.error.includes('ключ'));
const connections = await req('/api/connections');
assert(connections.providers.some(provider => provider.id === 'openai'));
const comparison = await req(path + '/generate', 'POST', {
  revision: p.revision, batchId: crypto.randomUUID(), itemId: p.items[0].id,
  models: ['gpt-6-astra', 'grok-4.6', 'MiniMax-M2.7'], count: 2,
  prompt: 'Доработай', refs: [], dialogue: '', voiceId: '', estimates: {},
}, 400);
assert(comparison.error.includes('ключ'), 'Three-model comparison reaches the missing-key guard');
const form = new FormData();
form.set(
  'file',
  new File(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    'test.png',
    { type: 'image/png' },
  ),
);
const a = await req('/api/assets', 'POST', form, 201);
const response = await fetch(origin + '/api/assets/' + a.id, { headers: auth });
assert.equal(response.status, 200);
assert((await response.arrayBuffer()).byteLength > 30);
assert.equal((await fetch(origin + '/api/assets/' + a.id)).status, 401);
for(let stage=1;stage<=4;stage++){
 const i=p.items.find(x=>x.stage===stage);
 const text=stage===4?JSON.stringify({shots:Array.from({length:10},(_,n)=>({title:'План '+(n+1),description:'Действие',duration:5,camera:'Наезд',dialogue:'',continuity:'Прямая склейка'}))}):'Актуальный материал';
 await act('addVariant',{title:'Актуально',text,kind:'text'},i.id);
 await act('approve',undefined,i.id);
}
await act('prepareShots');
assert.equal(p.items.filter(i=>i.stage===5).length,10);
assert.equal(p.items.filter(i=>i.stage===7).length,10);
assert.equal(p.items.find(i=>i.stage===5).variants[0].camera,'Наезд');
const preparedRevision=p.revision;
const preparedItems=structuredClone(p.items);
await act('prepareShots');
assert.equal(p.revision,preparedRevision,'Repeated preparation is an idempotent read');
assert.deepEqual(p.items,preparedItems,'Repeated preparation preserves existing cards and variants');
const reread = await req(path);
assert.equal(reread.items[0].variants.length, 2);
assert.equal(reread.items[1].variants.length, 2);
await act('saveCharacter',{profile:{name:'Лена',appearance:'Рыжие волосы, зелёная куртка',description:'Любопытная девочка',instructions:'Сохранить лицо',refs:[a.id]},imageId:a.id},'');
const hero=p.items.find(i=>i.character?.name==='Лена');
assert(hero?.variants[0].character,'The uploaded character image has its own profile snapshot');
await act('approve',undefined,hero.id);
const approvedHero=p.items.find(i=>i.id===hero.id);
assert.equal(approvedHero.approvedId,approvedHero.selectedId);
await act('saveCharacter',{profile:{...hero.character,name:'Черновое имя'}},hero.id);
const persistedHero=(await req(path)).items.find(i=>i.id===hero.id);
assert.equal(persistedHero.character.name,'Черновое имя');
assert.equal(persistedHero.variants.find(v=>v.id===persistedHero.approvedId).character.name,'Лена','Draft edits preserve the approved identity');
const logout = await fetch(origin + '/api/auth/logout', { method: 'POST', redirect: 'manual', headers: auth, signal: AbortSignal.timeout(30000) });
assert.equal(logout.status, 303);
assert(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
console.log(
  'PASS HTTP: authentication, project persistence, immutable versions, approval gates, stale dependencies, concurrent edits, CSRF, missing-key guard and private file upload.',
);
