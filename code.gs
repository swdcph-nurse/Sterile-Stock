// =========================================================================
// 💡 [ตั้งค่าระบบ LINE] กำหนดค่า TOKEN และ GROUP ID ไว้ที่นี่
// =========================================================================
const LINE_ACCESS_TOKEN = 'pzlJPJaY6FGOHbDGA0l0QNx90kKLHAlSehhUdAURuLdg0YaKrOr80FgvtcMeKENsgQ9JpBwz7K70+6epdSyd+J9HUfo1wQeZ7FCtY8xWEXO/yBeOqTLmCITe1oblQCKCbdc9BlV1YjTlM0UeIUaIZQdB04t89/1O/w1cDnyilFU='; // 💡 ใส่ Token เดิมของคุณ
const LINE_GROUP_ID = 'C474186c02e3e77beb9e742d29ad08c56'; // 💡 เมื่อได้รหัสกลุ่มที่ขึ้นต้นด้วยตัว C แล้ว นำมาวางแทนค่าที่นี่

/**
 * Sterile STOCK web app entry point and asset router.
 * This file keeps the deployment surface small and delegates business logic
 * to the service files so the app stays maintainable in Apps Script.
 */

/**
 * Serves the SPA shell or dynamic asset responses.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput|GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  ensureSchema_();

  const asset = (e && e.parameter && e.parameter.asset ? String(e.parameter.asset) : '').trim().toLowerCase();
  if (asset) {
    return serveAsset_(asset);
  }

  const apiMethod = (e && e.parameter && (e.parameter.action || e.parameter.api || e.parameter.method) ? String(e.parameter.action || e.parameter.api || e.parameter.method) : '').trim();
  if (apiMethod) {
    return serveApi_(e);
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.appConfig = getAppConfig_();
  template.manifestUrl = getAssetUrl_('manifest');
  template.serviceWorkerUrl = getAssetUrl_('sw');

  return template
    .evaluate()
    .setTitle(APP_CONFIG.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Serves JSON or JSONP API responses for GitHub Pages and other clients.
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function serveApi_(e) {
  const callback = safeText_(e && e.parameter && e.parameter.callback ? e.parameter.callback : '');
  const method = safeText_(e && e.parameter && (e.parameter.action || e.parameter.api || e.parameter.method) ? e.parameter.action || e.parameter.api || e.parameter.method : '');
  const payloadText = e && e.parameter && typeof e.parameter.payload === 'string' ? e.parameter.payload : '{}';
  const payload = parseJsonSafe_(payloadText);
  const allowedMethods = {
    getBootstrapData,
    getDashboardData,
    getMasterItems,
    getDashboardMetrics,
    getStockPage,
    searchStock,
    getStockByStatus,
    suggestItemCode,
    receiveStock,
    dispatchStock,
    getLabelInfo,
    markReceivePrinted,
    getSummaryData,
    exportSummaryCsv,
    getDashboard: (request) => getDashboardData(request),
    getStock: (request) => getStockPage(request),
    receiveItem: (request) => receiveStock(request),
    dispatchItem: (request) => dispatchStock(request),
    getReports: (request) => getSummaryData(request)
  };

  let body;
  try {
    if (!allowedMethods[method]) {
      throw new Error(`ไม่พบ API method: ${method}`);
    }
    body = { ok: true, data: allowedMethods[method](payload) };
  } catch (error) {
    body = { ok: false, error: getErrorMessage_(error) };
  }

  const json = JSON.stringify(body);
  const output = callback
    ? `${callback}(${json});`
    : json;

  return ContentService
    .createTextOutput(output)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

/**
 * Parses a JSON string safely.
 * @param {string} text
 * @returns {Object}
 */
function parseJsonSafe_(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    return {};
  }
}

/**
 * Extracts a readable error message from any exception.
 * @param {*} error
 * @returns {string}
 */
function getErrorMessage_(error) {
  const message = error && error.message ? String(error.message) : String(error || 'เกิดข้อผิดพลาด');
  return message.replace(/^VALIDATION:/, '');
}

/**
 * Includes an HTML partial into the current template.
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Returns the unified app configuration used by the frontend.
 * @returns {Object}
 */
function getAppConfig() {
  return getAppConfig_();
}


// =========================================================================
// 💡 [ส่วนปรับปรุงใหม่] รองรับทั้งพิมพ์ "เช็คสต๊อก" และตั้งเวลาทริกเกอร์รายสัปดาห์
// =========================================================================

/**
 * ฟังก์ชันจัดการระบบรับสัญญาณจาก LINE Webhook (POST) - สำหรับการพิมพ์สั่งงาน
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data.events || data.events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    const event = data.events[0];

    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text.trim();
      const replyToken = event.replyToken;

      // ถ้ามีคนพิมพ์ว่า "เช็คสต๊อก" -> ทำงานแบบ Reply (ตอบกลับทันที)
      if (userMessage === 'เช็คสต๊อก') {
        checkAndNotifyExpiringItems(replyToken); 
      }
      
      // ถ้าพิมพ์ว่า "เช็คไอดีกลุ่ม" -> ส่งไอดีกลุ่มกลับไป
      else if (userMessage === 'เช็คไอดีกลุ่ม') {
        if (event.source.type === 'group') {
           replyText("🎯 Group ID ของห้องนี้คือ:\n" + event.source.groupId, replyToken);
        } else {
           replyText("คุณไม่ได้อยู่ในกลุ่ม กรุณาพิมพ์คำสั่งนี้ในห้องกลุ่มครับ", replyToken);
        }
      }
    }
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดใน doPost: " + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ⏰ ฟังก์ชันสำหรับให้ตั้งเวลา Trigger รายสัปดาห์ (ห้ามลบฟังก์ชันนี้)
 * ฟังก์ชันนี้จะถูกเรียกโดยอัตโนมัติตามเวลาที่เราตั้งไว้ และจะส่งแบบ Push เข้ากลุ่มโดยตรง
 */
function triggerWeeklyCheck() {
  console.log("⏰ เริ่มทำงานตรวจเช็คสต๊อกอัตโนมัติรายสัปดาห์...");
  // เรียกฟังก์ชันหลักโดยไม่ส่ง replyToken เพื่อให้มันส่งแบบ Push เข้ากลุ่ม
  checkAndNotifyExpiringItems(null); 
}


/**
 * ฟังก์ชันหลักในการตรวจสอบรายการวัสดุใกล้หมดอายุ
 * @param {string|null} replyToken - หากมีค่าจะส่งแบบ Reply (ฟรี) หากเป็น null จะส่งแบบ Push (หักโควต้า)
 */
function checkAndNotifyExpiringItems(replyToken) {
  SpreadsheetApp.flush();

  const sheet = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId).getSheetByName(SHEET_NAMES.STOCK);
  if (!sheet) {
    console.error(" ไม่พบ Sheet ชื่อ: " + SHEET_NAMES.STOCK);
    if (replyToken) replyText("❌ ระบบขัดข้อง: ไม่พบฐานข้อมูล Sheet " + SHEET_NAMES.STOCK, replyToken);
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    if (replyToken) replyText("ℹ️ ไม่พบข้อมูลวัสดุในระบบ", replyToken);
    return;
  }
  
  const headers = data[0];
  const codeIdx = headers.indexOf("ItemCode");
  const nameIdx = headers.indexOf("ชื่อรายการ");
  const expireIdx = headers.indexOf("วันที่หมดอายุ");
  const qtyIdx = headers.indexOf("จำนวนคงเหลือ");
  
  if (codeIdx === -1 || expireIdx === -1 || qtyIdx === -1) {
    if (replyToken) replyText("❌ ระบบขัดข้อง: โครงสร้างตารางไม่ถูกต้อง", replyToken);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0); 
  
  let flexItems = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const expireDate = new Date(row[expireIdx]);
    const qty = Number(row[qtyIdx]) || 0;
    
    if (qty <= 0 || isNaN(expireDate.getTime())) continue;
    
    const diffTime = expireDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 3) {
      const itemName = nameIdx !== -1 ? row[nameIdx] : "ไม่ระบุชื่อ";
      let statusText = ""; let statusColor = ""; let badgeBg = "";
      
      if (diffDays < 0) { statusText = " หมดอายุแล้ว"; statusColor = "#ef4444"; badgeBg = "#fef2f2"; } 
      else if (diffDays === 0) { statusText = " หมดอายุวันนี้"; statusColor = "#f97316"; badgeBg = "#fff7ed"; } 
      else { statusText = ` ใกล้หมดอายุใน ${diffDays} วัน`; statusColor = "#d97706"; badgeBg = "#fef9c3"; }

      flexItems.push({
        "type": "box", "layout": "vertical", "backgroundColor": "#ffffff", "cornerRadius": "md", "paddingAll": "md", "margin": "sm", "borderWidth": "1px", "borderColor": "#e2e8f0",
        "contents": [
          { "type": "text", "text": itemName, "weight": "bold", "size": "sm", "color": "#0f172a", "wrap": true },
          {
            "type": "box", "layout": "horizontal", "margin": "xs",
            "contents": [
              { "type": "text", "text": `รหัส: ${row[codeIdx]}`, "size": "xs", "color": "#64748b", "flex": 3 },
              { "type": "text", "text": `คงเหลือ: ${qty} ชิ้น`, "size": "xs", "color": "#0f766e", "weight": "bold", "align": "end", "flex": 2 }
            ]
          },
          {
            "type": "box", "layout": "horizontal", "margin": "xs", "backgroundColor": badgeBg, "cornerRadius": "sm", "paddingStart": "sm", "paddingEnd": "sm", "paddingTop": "xs", "paddingBottom": "xs",
            "contents": [ { "type": "text", "text": statusText, "size": "xs", "color": statusColor, "weight": "bold" } ]
          }
        ]
      });
    }
  }

  // กรณีไม่มีรายการใกล้หมดอายุ
  if (flexItems.length === 0) {
    console.log(" ไม่มีรายการหมดอายุสะสม");
    if (replyToken) {
      // ถ้าคนพิมพ์มาเช็ค ให้ตอบกลับบอกว่าไม่มี
      replyText("✅ ตรวจสอบสต๊อกแล้ว: ปัจจุบันไม่มีวัสดุปราศจากเชื้อที่ใกล้หมดอายุ (ภายใน 3 วัน) ครับ", replyToken);
    }
    // ถ้าเป็นระบบตั้งเวลาอัตโนมัติ (Trigger) จะไม่ส่งอะไรเข้ากลุ่มเลยเพื่อไม่ให้รก
    return;
  }

  // จัดรูปแบบข้อความ Flex Message
  const now = new Date();
  const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dateStr = now.getDate() + " " + thaiMonths[now.getMonth()] + " " + (now.getFullYear() + 543);
  const timeStr = Utilities.formatDate(now, "GMT+7", "HH:mm") + " น.";

  const flexContainer = {
    "type": "bubble",
    "header": {
      "type": "box", "layout": "vertical", "backgroundColor": "#0f766e", "paddingAll": "lg",
      "contents": [
        { "type": "text", "text": " แจ้งเตือนคลังวัสดุปราศจากเชื้อ", "weight": "bold", "color": "#ffffff", "size": "md" },
        { "type": "text", "text": `ประจำวันที่ ${dateStr} เวลา ${timeStr}`, "color": "#ccfbf1", "size": "xs", "margin": "xs" }
      ]
    },
    "body": {
      "type": "box", "layout": "vertical", "backgroundColor": "#f8fafc", "paddingAll": "md",
      "contents": [
        { "type": "text", "text": `พบรายการใกล้หมดอายุทั้งหมด ${flexItems.length} รายการ`, "weight": "bold", "size": "xs", "color": "#334155", "margin": "xs" },
        { "type": "box", "layout": "vertical", "margin": "md", "spacing": "xs", "contents": flexItems }
      ]
    },
    "footer": {
      "type": "box", "layout": "vertical", "backgroundColor": "#ffffff", "paddingAll": "md",
      "contents": [
        {
          "type": "button",
          "action": { "type": "uri", "label": " กดเข้าลิงก์ตรวจสอบในระบบ", "uri": "https://swdcph-nurse.github.io/Sterile-Stock/" },
          "style": "primary", "color": "#0f766e", "height": "sm"
        }
      ]
    }
  };

  // ตัดสินใจช่องทางการส่งข้อมูล
  if (replyToken) {
    sendLineFlexReply(flexContainer, replyToken); 
  } else {
    sendLineFlexPush(flexContainer, LINE_GROUP_ID);
  }
}

/**
 * 🚀 ช่องทางที่ 1: ส่งตอบกลับ (Reply) - ฟรี
 */
function sendLineFlexReply(flexContainerStructure, replyToken) {
  executeLineApi_("https://api.line.me/v2/bot/message/reply", {
    "replyToken": replyToken, "messages": [{ "type": "flex", "altText": "⚠️ มีแจ้งเตือนวัสดุปราศจากเชื้อใกล้หมดอายุ", "contents": flexContainerStructure }]
  }, "Reply");
}

/**
 * 🚀 ช่องทางที่ 2: ส่งเจาะจงกลุ่ม (Push) - หักโควต้ารายเดือน
 */
function sendLineFlexPush(flexContainerStructure, targetGroupId) {
  executeLineApi_("https://api.line.me/v2/bot/message/push", {
    "to": targetGroupId, "messages": [{ "type": "flex", "altText": "⚠️ มีแจ้งเตือนวัสดุปราศจากเชื้อใกล้หมดอายุ", "contents": flexContainerStructure }]
  }, "Push");
}

/**
 * ช่องทางส่งข้อความตัวอักษรธรรมดาแบบตอบกลับ
 */
function replyText(textMessage, replyToken) {
  executeLineApi_("https://api.line.me/v2/bot/message/reply", {
    "replyToken": replyToken, "messages": [{ "type": "text", "text": textMessage }]
  }, "ReplyText");
}

/**
 * ตัวยิง API สื่อสารกับ LINE
 */
function executeLineApi_(url, payload, modeName) {
  const options = {
    "method": "post",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer " + LINE_ACCESS_TOKEN },
    "payload": JSON.stringify(payload), "muteHttpExceptions": true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      console.log(`✅ ส่งข้อมูลสำเร็จ (${modeName})`);
    } else {
      console.error(`❌ ส่งล้มเหลว (${modeName}) โค้ด: ` + response.getResponseCode() + " รายละเอียด: " + response.getContentText());
    }
  } catch (error) {
    console.error(`❌ เชื่อมต่อ LINE API ผิดพลาด (${modeName}): ` + error);
  }
}
