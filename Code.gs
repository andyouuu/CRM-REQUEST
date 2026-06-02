/**
 * CRM «Заявки» — серверная часть (Google Apps Script).
 *
 * Script Properties (Проект → Свойства скрипта):
 *   TELEGRAM_BOT_TOKEN — токен бота
 *   TELEGRAM_CHAT_ID   — ID чата или канала
 *
 * Один раз выполните setupSheet() в редакторе, чтобы создать лист «Заявки».
 */

const SHEET_NAME = 'Заявки';
const HEADERS = ['id', 'name', 'phone', 'comment', 'createdAt'];

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  const range = sheet.getRange(1, 1, 1, HEADERS.length);
  if (range.getValues()[0].join('') !== HEADERS.join('')) {
    range.setValues([HEADERS]);
    range.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  Logger.log('Лист «' + SHEET_NAME + '» готов.');
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    setupSheet();
    sheet = ss.getSheetByName(SHEET_NAME);
  }
  return sheet;
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  try {
    if (action === 'list') {
      return jsonResponse_({ ok: true, requests: listRequests_() });
    }
    if (action === 'create') {
      const created = createRequest_({
        name: e.parameter.name,
        phone: e.parameter.phone,
        comment: e.parameter.comment || '',
      });
      return jsonResponse_({ ok: true, request: created });
    }
    if (action === 'delete') {
      const id = e.parameter.id;
      deleteRequest_(id);
      return jsonResponse_({ ok: true, id: id });
    }
    return jsonResponse_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = body.action;

    if (action === 'list') {
      return jsonResponse_({ ok: true, requests: listRequests_() });
    }
    if (action === 'create') {
      const created = createRequest_({
        name: body.name,
        phone: body.phone,
        comment: body.comment || '',
      });
      return jsonResponse_({ ok: true, request: created });
    }
    if (action === 'delete') {
      deleteRequest_(body.id);
      return jsonResponse_({ ok: true, id: body.id });
    }
    return jsonResponse_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function listRequests_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow, HEADERS.length).getValues();
  return values
    .map(function (row) {
      return {
        id: String(row[0]),
        name: String(row[1]),
        phone: String(row[2]),
        comment: String(row[3]),
        createdAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4]),
      };
    })
    .reverse();
}

function createRequest_(data) {
  const name = trim_(data.name);
  const phone = trim_(data.phone);
  const comment = trim_(data.comment);

  if (!name) throw new Error('Укажите имя');
  if (!phone) throw new Error('Укажите телефон');

  const id = Utilities.getUuid();
  const createdAt = new Date();
  const sheet = getSheet_();
  sheet.appendRow([id, name, phone, comment, createdAt]);

  const request = {
    id: id,
    name: name,
    phone: phone,
    comment: comment,
    createdAt: createdAt.toISOString(),
  };

  sendTelegramNotification_(request);
  return request;
}

function deleteRequest_(id) {
  if (!id) throw new Error('Не указан id заявки');

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Заявка не найдена');

  const ids = sheet.getRange(2, 1, lastRow, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
  throw new Error('Заявка не найдена');
}

function sendTelegramNotification_(request) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');

  if (!token || !chatId) {
    Logger.log('Telegram: пропуск — не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');
    return;
  }

  const text =
    '🆕 Новая заявка\n\n' +
    'Имя: ' + request.name + '\n' +
    'Телефон: ' + request.phone + '\n' +
    'Комментарий: ' + (request.comment || '—');

  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true,
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('Telegram error ' + code + ': ' + response.getContentText());
  }
}

function trim_(value) {
  return value == null ? '' : String(value).trim();
}
