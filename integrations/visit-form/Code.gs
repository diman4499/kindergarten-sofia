// Deploy as an Apps Script web app. Secrets belong in Script Properties only.
const VISIT_AGES = ['10 месеца', '11 месеца', '1 година', '1–2 години', '2–3 години'];
const VISIT_LOCATIONS = ['Овча купел — Монтевидео 4'];
const VISIT_HEADERS = ['ID', 'Получено на', 'Име на родител', 'Телефон', 'Възраст', 'Локация', 'Предпочитано време', 'Бележки', 'Съгласие', 'Статус', 'Telegram'];

function validateVisit_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request');
  function field(name, max, required) {
    const value = data[name] == null ? '' : data[name];
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid field');
    const cleaned = value.trim();
    if (required && !cleaned) throw new Error('Required field');
    return cleaned;
  }
  const requestId = field('requestId', 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Invalid ID');
  if (field('website', 200, false)) throw new Error('Spam');
  const parentName = field('parentName', 100, true);
  const phone = field('phone', 25, true);
  const digits = phone.replace(/\D/g, '');
  const childAge = field('childAge', 40, true);
  const location = field('location', 100, false) || VISIT_LOCATIONS[0];
  if (parentName.length < 2 || !/^[+0-9() .-]+$/.test(phone) || digits.length < 7 || digits.length > 15) throw new Error('Invalid contact');
  if (!VISIT_AGES.includes(childAge) || !VISIT_LOCATIONS.includes(location) || data.consent !== 'yes') throw new Error('Invalid selection');
  return {requestId, parentName, phone, childAge, location, preferredTime: field('preferredTime', 150, false), notes: field('notes', 1500, false)};
}

function sheetText_(value) {
  // Store user input as literal text, including phone numbers and formula prefixes.
  return "'" + value;
}

function doPost(e) {
  let lock;
  let locked = false;
  try {
    if (!e || !e.postData || e.postData.contents.length > 10000) throw new Error('Invalid body');
    const visit = validateVisit_(JSON.parse(e.postData.contents));
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Not configured');
    lock = LockService.getScriptLock();
    lock.waitLock(15000);
    locked = true;
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Посещения') || spreadsheet.insertSheet('Посещения');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(VISIT_HEADERS);
      sheet.setFrozenRows(1);
    }
    const count = sheet.getLastRow();
    const duplicate = count > 1 && sheet.getRange(2, 1, count - 1, 1).createTextFinder(visit.requestId).matchEntireCell(true).findNext();
    if (duplicate) return visitJson_({ok: true, requestId: visit.requestId});
    const cache = CacheService.getScriptCache();
    const phoneKey = 'phone:' + visit.phone.replace(/\D/g, '');
    if (cache.get(phoneKey)) return visitJson_({ok: false});
    sheet.appendRow([
      visit.requestId, new Date(), sheetText_(visit.parentName), sheetText_(visit.phone),
      sheetText_(visit.childAge), sheetText_(visit.location), sheetText_(visit.preferredTime),
      sheetText_(visit.notes), 'yes', 'Нова', 'Не е настроен'
    ]);
    SpreadsheetApp.flush();
    cache.put(phoneKey, '1', 60);
    const row = sheet.getLastRow();
    // Persist first: a Telegram outage must never discard a saved appointment.
    try {
      const token = properties.getProperty('TELEGRAM_BOT_TOKEN');
      const chatId = properties.getProperty('TELEGRAM_CHAT_ID');
      if (token && chatId) {
        const message = ['⭐ Нова заявка за посещение — Star Kids',
          'Родител: ' + visit.parentName, 'Телефон: ' + visit.phone,
          'Възраст: ' + visit.childAge, 'Локация: ' + visit.location,
          'Време: ' + (visit.preferredTime || 'Не е посочено'),
          'Бележки: ' + (visit.notes || 'Няма'), 'ID: ' + visit.requestId].join('\n');
        const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
          method: 'post', contentType: 'application/json',
          payload: JSON.stringify({chat_id: chatId, text: message}), muteHttpExceptions: true
        });
        const sent = response.getResponseCode() === 200 && JSON.parse(response.getContentText()).ok === true;
        sheet.getRange(row, 11).setValue(sent ? 'Изпратено' : 'Грешка — проверете таблицата');
      }
    } catch (ignored) {
      try { sheet.getRange(row, 11).setValue('Грешка — проверете таблицата'); } catch (ignoredStatus) {}
    }
    return visitJson_({ok: true, requestId: visit.requestId});
  } catch (ignored) {
    // No personal data, spreadsheet identifiers, or tokens in the public response.
    return visitJson_({ok: false});
  } finally {
    if (locked) lock.releaseLock();
  }
}

function visitJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
