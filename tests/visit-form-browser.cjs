// Run with Playwright installed: node tests/visit-form-browser.cjs
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + req.url.split('?')[0]);
  if (!file.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
  try {
    const content = fs.readFileSync(file);
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'image/svg+xml');
    res.end(content);
  } catch {res.writeHead(404).end();}
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.route('https://www.google.com/**', route => route.abort());
    const url = `http://127.0.0.1:${server.address().port}/kontakti.html`;
    await page.goto(url);
    const submit = page.locator('.visit-submit');
    assert.equal(await submit.isDisabled(), true);
    assert.match(await page.locator('#visit-status').textContent(), /подготвя/);
    await page.route('**/assets/visit-form-config.js', route => route.fulfill({contentType:'application/javascript', body:"window.VISIT_FORM_ENDPOINT='https://script.google.com/macros/s/test/exec';"}));
    let failure = true;
    const ids = [];
    await page.route('https://script.google.com/macros/s/test/exec', route => {
      const data = route.request().postDataJSON();
      ids.push(data.requestId);
      return failure ? route.abort() : route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,requestId:data.requestId})});
    });
    await page.reload();
    assert.equal(await submit.isEnabled(), true);
    await submit.click();
    assert.equal(ids.length, 0);
    await page.locator('#parent-name').fill('Тест Родител');
    await page.locator('#parent-phone').fill('+359 88 123 4567');
    await page.locator('#child-age').selectOption({label:'1–2 години'});
    await page.locator('#visit-location').selectOption({label:'Овча купел — Монтевидео 4'});
    await page.locator('[name="consent"]').check();
    for (const width of [390,1280]) {
      await page.setViewportSize({width,height:1100});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await submit.click();
    await page.locator('#visit-status[data-state="error"]').waitFor();
    assert.equal(await page.locator('#parent-name').inputValue(), 'Тест Родител');
    failure = false;
    await submit.click();
    await page.locator('#visit-status[data-state="success"]').waitFor();
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
    assert.equal(await page.locator('#parent-name').inputValue(), '');
    await page.setViewportSize({width:390,height:1200});
    await page.locator('#visit').screenshot({path:'/workspace/scratch/6b517bc05f70/visit-mobile.png'});
    console.log('Browser checks passed: disabled setup, required fields, mobile/desktop width, failed request preserves input, retry ID, confirmed success/reset.');
  } finally {await browser.close(); server.close();}
})().catch(error => {console.error(error); server.close(); process.exitCode=1;});
