const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../integrations/visit-form/Code.gs'), 'utf8');
const valid = () => ({requestId:'12345678-1234-4123-8123-123456789abc', parentName:'Тест Родител', phone:'+359 88 961 8169', childAge:'1–2 години', location:'Овча купел — Монтевидео 4', consent:'yes', notes:'Тест', website:''});

function server(telegramFails = false) {
  const rows = [];
  let sends = 0;
  const cache = new Map();
  const sheet = {
    getLastRow: () => rows.length, appendRow: row => rows.push(row), setFrozenRows() {},
    getRange: (row, column) => ({
      createTextFinder: value => ({matchEntireCell: () => ({findNext: () => rows.slice(1).find(r => r[0] === value) || null})}),
      setValue: value => {rows[row - 1][column - 1] = value;}
    })
  };
  const context = vm.createContext({
    ContentService: {MimeType:{JSON:'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => ({SPREADSHEET_ID:'test', TELEGRAM_BOT_TOKEN:'fake', TELEGRAM_CHAT_ID:'fake'})[key]})},
    LockService:{getScriptLock: () => ({waitLock(){}, releaseLock(){}})},
    SpreadsheetApp:{openById: () => ({getSheetByName: () => sheet}), flush(){}},
    CacheService:{getScriptCache: () => ({get: key => cache.get(key), put: (key, value) => cache.set(key, value)})},
    UrlFetchApp:{fetch: () => {sends++; if (telegramFails) throw Error('outage'); return {getResponseCode: () => 200, getContentText: () => '{"ok":true}'};}}
  });
  vm.runInContext(code, context);
  return {context, rows, sends: () => sends, submit: data => context.doPost({postData:{contents:JSON.stringify(data)}})};
}

test('valid request is saved once and notified once; retry acknowledges same ID', () => {
  const s = server();
  assert.equal(s.submit(valid()).ok, true);
  assert.equal(s.submit(valid()).ok, true);
  assert.equal(s.rows.length, 2);
  assert.equal(s.sends(), 1);
  assert.equal(s.rows[1][10], 'Изпратено');
});
test('Telegram failure preserves saved request and returns success', () => {
  const s = server(true);
  assert.equal(s.submit(valid()).ok, true);
  assert.equal(s.rows.length, 2);
  assert.match(s.rows[1][10], /Грешка/);
});
test('reject missing consent, spam, invalid selections, bad phones, long notes and malformed IDs', () => {
  for (const patch of [{consent:''},{website:'spam'},{childAge:'unknown'},{location:'unknown'},{phone:'-------'},{notes:'x'.repeat(1501)},{requestId:'bad'},{parentName:' '}]) {
    const s = server();
    assert.equal(s.submit({...valid(), ...patch}).ok, false);
    assert.equal(s.rows.length, 0);
  }
});
test('formula-like input remains literal sheet text', () => {
  const s = server();
  assert.equal(s.submit({...valid(), parentName:'=IMPORTXML("test")', notes:'@SUM(1,2)'}).ok, true);
  assert.equal(s.rows[1][2], '\'=IMPORTXML("test")');
  assert.equal(s.rows[1][7], "'@SUM(1,2)");
});
test('different request from same phone is throttled', () => {
  const s = server();
  s.submit(valid());
  assert.equal(s.submit({...valid(), requestId:'22345678-1234-4123-8123-123456789abc'}).ok, false);
  assert.equal(s.rows.length, 2);
});


test('new age choices accept a request without a location selector and persist the sole base', () => {
  for (const childAge of ['10 месеца', '11 месеца', '1 година', '1–2 години', '2–3 години']) {
    const s = server();
    const data = {...valid(), childAge};
    delete data.location;
    assert.equal(s.submit(data).ok, true);
    assert.equal(s.rows[1][4], "'" + childAge);
    assert.equal(s.rows[1][5], "'Овча купел — Монтевидео 4");
  }
});

test('child name is preserved as literal text and older requests without it still work', () => {
  const s = server();
  assert.equal(s.submit({...valid(), childName:'=Тест Дете'}).ok, true);
  assert.equal(s.rows[1][11], "'=Тест Дете");
  assert.equal(server().submit(valid()).ok, true);
  assert.equal(server().submit({...valid(), childName:'x'.repeat(101)}).ok, false);
});
