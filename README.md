# Sterile STOCK

ระบบคลังเครื่องมือ และวัสดุปราศจากเชื้อ ตึกพิเศษปาริฉัตร

## โครงสร้างที่แยกแล้ว

- `index.html`, `app.js`, `Styles.html`, `Scripts.html`, `dashboard.html`, `receive.html`, `dispatch.html`, `reports.html`, `print.html`, `manifest.json`, `service-worker.js`, `icon.png` คือชุดสำหรับ GitHub Pages frontend
- `gas/Code.gs`, `gas/Utils.gs`, `gas/StockService.gs`, `gas/ReportService.gs`, `gas/Index.html`, `gas/Styles.html`, `gas/Scripts.html`, `gas/dashboard.html`, `gas/receive.html`, `gas/dispatch.html`, `gas/reports.html`, `gas/print.html`, `gas/appsscript.json` คือชุดสำหรับ Google Apps Script backend
- GitHub Pages frontend จะเรียก GAS ผ่าน JSONP API โดยใช้ URL เว็บแอปใน `window.STERILE_API_URL`

## วิธีเชื่อม Google Sheets

1. เปิด Spreadsheet ID: `1U10pMDTQdlJieOO_kl9PAgfOAKRnjNUiZjrhmTtPLUU`
2. ถ้าต้องการเปลี่ยนไฟล์ชีต ให้แก้ `APP_CONFIG.spreadsheetId` ใน `gas/Utils.gs`
3. ระบบจะสร้างชีต `Data`, `Stock`, `ReceiveLogs`, `DispatchLogs`, `Settings` ให้อัตโนมัติเมื่อเปิดเว็บแอปครั้งแรก

## วิธี Deploy ไป Google Apps Script

1. สร้าง Apps Script Project แบบ Standalone หรือ Bound to Spreadsheet
2. นำไฟล์ในโฟลเดอร์ `gas/` ไปใส่ในโปรเจกต์
3. ตั้งค่า Spreadsheet ID ให้ตรงกับไฟล์จริง
4. Deploy > New deployment > Web app
5. ตั้งค่า Execute as: `User deploying the web app`
6. ตั้งค่า Who has access: ตามนโยบายหน่วยงาน

## วิธีใช้ Thermal Printer

- หน้า `Receive` จะเปิดหน้าพิมพ์สติ๊กเกอร์อัตโนมัติหลังบันทึกสำเร็จ
- สติ๊กเกอร์ใช้ขนาด `2 x 1 inch`
- รองรับ Barcode และ QR Code
- สามารถสั่งพิมพ์ย้อนหลังได้จาก Dashboard ตาราง Stock

## วิธีใช้ PWA

- เปิดเว็บแอปผ่าน HTTPS ของ GAS
- Browser รองรับ `beforeinstallprompt` จะมีปุ่มติดตั้งแอปแสดงขึ้น
- Service Worker จะช่วย cache shell ของแอปเพื่อประสบการณ์แบบแอปมือถือ

## วิธี Push GitHub

```bash
git add .
git commit -m "Build Sterile STOCK enterprise web app"
git push
```

## Permissions ที่ต้องใช้

- Spreadsheet access สำหรับอ่าน/เขียนข้อมูล
- Apps Script execution สำหรับ `LockService`, `Utilities`, `Session`
- ผู้ใช้ควรได้รับสิทธิ์เข้าถึง Spreadsheet ที่ตั้งเป็นฐานข้อมูล

## หมายเหตุการใช้งานจริง

- Master data รายการวัสดุให้กรอกที่ชีต `Data`
- ระบบจ่ายออกจะลบแถวใน `Stock` เมื่อคงเหลือเป็น 0 ตาม requirement ล่าสุด
- รายงานสรุปใช้ปีงบประมาณ ตุลาคม → กันยายน
- ถ้าจะเปลี่ยน GAS endpoint สำหรับ GitHub Pages ให้แก้ค่าใน `index.html` หรือกำหนด `window.STERILE_API_URL` ก่อนโหลด `app.js`
