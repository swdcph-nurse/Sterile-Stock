const DEFAULT_GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzlGRp0bvvO1yYXQsCX8eVeQqNqeNhVro6r8E7IQlwVv0ypBi7kK1GtYOcQqsRaL9zl/exec';
const GAS_API_URL = (window.STERILE_API_URL || document.querySelector('meta[name="gas-api-url"]')?.content || DEFAULT_GAS_API_URL).replace(/\/$/, '');
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const state = {
  bootstrap: null,
  masterItems: [],
  stockPage: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 },
  metrics: null,
  activeView: 'dashboard',
  sort: { field: 'LastUpdate', direction: 'desc' },
  filters: { query: '', status: 'all', date: '', page: 1, pageSize: 10 },
  report: { fiscalYearStart: null, month: 'all' },
  charts: {},
  labelWindow: null,
  modal: null,
  scanner: { stream: null, detector: null, reader: null, controls: null, active: false, mode: '' }
};

let booted = false;
const bootApp = async () => {
  if (booted) {
    return;
  }
  booted = true;
  await initApp();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

/** Boots the entire SPA and fetches the first server payload. */
async function initApp() {
  bindGlobalEvents();
  registerPwa();
  setupDefaultDates();
  await loadBootstrap();
}

/** Binds navigation, forms and global actions. */
function bindGlobalEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (view) {
        switchView(view);
      }
    });
  });

  // ตัวกรองค้นหา ItemCode / ชื่อ
  document.getElementById('stockSearchInput')?.addEventListener('input', debounce((event) => {
    state.filters.query = event.target.value.trim();
    state.filters.page = 1;
    refreshStockPage();
  }, 220));

  // ตัวกรองสถานะ
  document.getElementById('stockStatusFilter')?.addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    state.filters.page = 1;
    refreshStockPage();
  });

  // ตัวกรองวันที่รับเข้า (เพิ่มใหม่)
  document.getElementById('filterDate')?.addEventListener('change', (event) => {
    state.filters.date = event.target.value;
    state.filters.page = 1;
    refreshStockPage();
  });

  // Event เลือก Checkbox ทั้งหมด (เพิ่มใหม่)
  document.getElementById('selectAllStock')?.addEventListener('change', (event) => {
    const isChecked = event.target.checked;
    document.querySelectorAll('.stock-checkbox').forEach(cb => {
      cb.checked = isChecked;
    });
  });

  // Event ปุ่มพิมพ์รายการที่เลือก (เพิ่มใหม่)
  document.getElementById('printSelectedBtn')?.addEventListener('click', () => {
    const selectedCbs = document.querySelectorAll('.stock-checkbox:checked');
    if (selectedCbs.length === 0) {
      showToast('warning', 'แจ้งเตือน', 'กรุณาเลือกรายการที่ต้องการพิมพ์อย่างน้อย 1 รายการ');
      return;
    }

    const selectedItems = Array.from(selectedCbs).map(cb => {
      const itemCode = cb.value;
      const quantity = parseInt(cb.getAttribute('data-qty'), 10) || 1; 
      const item = state.stockPage.items.find(i => i.itemCode === itemCode);
      return { item, copies: quantity }; // พิมพ์เท่ากับจำนวนคงเหลือ
    }).filter(i => i.item && i.copies > 0);

    if (selectedItems.length === 0) {
      showToast('warning', 'แจ้งเตือน', 'รายการที่เลือกไม่มีจำนวนคงคลังให้พิมพ์');
      return;
    }

    printBatchLabels(selectedItems);
  });

  document.getElementById('stockRefreshBtn')?.addEventListener('click', () => refreshDashboard(true));
  document.getElementById('dispatchRefreshBtn')?.addEventListener('click', () => selectDispatchItem(null));
  document.getElementById('dispatchSearchBtn')?.addEventListener('click', () => handleDispatchSearch());
  document.getElementById('dispatchSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleDispatchSearch();
    }
  });
  document.getElementById('dispatchSearchInput')?.addEventListener('input', debounce(handleDispatchSearch, 250));
  document.getElementById('openScannerBtn')?.addEventListener('click', openScannerModal);

  document.getElementById('receiveForm')?.addEventListener('submit', handleReceiveSubmit);
  document.getElementById('receiveResetBtn')?.addEventListener('click', resetReceiveForm);
  document.getElementById('receiveItemSearch')?.addEventListener('input', debounce((event) => {
    handleReceiveItemSearch(event.target.value);
  }, 120));
  document.getElementById('receiveItemSearch')?.addEventListener('focus', (event) => {
    handleReceiveItemSearch(event.target.value);
  });
  document.getElementById('receiveItemSearch')?.addEventListener('keydown', handleReceiveItemSearchKeydown);
  
  ['receiveQuantity', 'receiveSterileDate', 'receiveExpireDate'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', debounce(refreshReceiveCodePreview, 200));
    document.getElementById(id)?.addEventListener('change', refreshReceiveCodePreview);
  });
  
  document.getElementById('dispatchForm')?.addEventListener('submit', handleDispatchSubmit);
  document.getElementById('dispatchClearBtn')?.addEventListener('click', () => selectDispatchItem(null));

  document.getElementById('reportFiscalYear')?.addEventListener('change', refreshReports);
  document.getElementById('reportMonth')?.addEventListener('change', refreshReports);
  document.getElementById('reportExportCsvBtn')?.addEventListener('click', exportSummaryExcelLike);
  document.getElementById('reportPrintBtn')?.addEventListener('click', printSummaryReport);
  document.getElementById('reportPdfBtn')?.addEventListener('click', printSummaryReport);

  document.getElementById('installPwaBtn')?.addEventListener('click', installPwaPrompt);
  document.getElementById('receiveDate')?.addEventListener('change', refreshReceiveCodePreview);
}

/** Loads initial bootstrap data from the backend. */
async function loadBootstrap() {
  showLoading(true);
  try {
    const bootstrap = await apiCall('getDashboardData', {
      page: state.filters.page,
      pageSize: state.filters.pageSize,
      query: state.filters.query,
      status: state.filters.status,
      date: state.filters.date, // ส่งข้อมูลตัวกรองวันที่
      sortField: state.sort.field,
      sortDirection: state.sort.direction,
      fiscalYearStart: state.report.fiscalYearStart,
      month: state.report.month
    });
    state.bootstrap = bootstrap;
    state.metrics = bootstrap.dashboard;
    state.stockPage = bootstrap.stockPage;
    state.summary = bootstrap.summary;
    state.report = {
      fiscalYearStart: bootstrap.summary ? bootstrap.summary.fiscalYearStart : guessCurrentFiscalYearStart(),
      month: 'all'
    };
    populateMasterDropdown(bootstrap.masters || []);
    populateFiscalYearSelect();
    renderDashboardMetrics(bootstrap.dashboard);
    renderStockPage(bootstrap.stockPage);
    renderReceivePreviewSkeleton();
    refreshReceiveCodePreview();
    updateActiveNav('dashboard');
    showToast('success', 'โหลดข้อมูลสำเร็จ', 'ระบบพร้อมใช้งานเรียบร้อยแล้ว');
  } catch (error) {
    showModal('เกิดข้อผิดพลาด', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`, {
      primaryLabel: 'ลองใหม่',
      onPrimary: () => loadBootstrap()
    });
  } finally {
    showLoading(false);
  }
}

/** Switches the visible SPA section. */
async function switchView(view) {
  window.SterileBarcodeScanner?.close?.();
  state.activeView = view;
  document.querySelectorAll('.view').forEach((section) => section.classList.remove('active'));
  const activeSection = document.getElementById(`view-${view}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }
  updateActiveNav(view);

  if (view === 'dashboard') {
    await refreshDashboard(false);
  }
  if (view === 'receive') {
    refreshReceiveDefaults();
  }
  if (view === 'dispatch') {
    resetDispatchPanel();
  }
  if (view === 'reports') {
    await refreshReports();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Updates the active navigation pill. */
function updateActiveNav(view) {
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
}

/** Populates the receive dropdown with master items. */
function populateMasterDropdown(items) {
  const select = document.getElementById('receiveItemName');
  const searchInput = document.getElementById('receiveItemSearch');
  const previous = select.value || searchInput.value;
  state.masterItems = Array.isArray(items) ? items.slice() : [];
  select.innerHTML = '';
  if (!items.length) {
    select.value = '';
    searchInput.value = '';
    renderReceiveItemSuggestions('');
    select.disabled = true;
    return;
  }
  select.disabled = false;
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = item.type ? `${item.name} (${item.type})` : item.name;
    option.dataset.meta = JSON.stringify(item);
    select.appendChild(option);
  });
  if (previous) {
    const matched = findReceiveItemByQuery(previous);
    if (matched) {
      select.value = matched.name;
      searchInput.value = matched.name;
    } else {
      select.value = '';
      searchInput.value = previous;
    }
  }
  renderReceiveItemSuggestions(searchInput.value);
}

/** Finds a master item by exact or fuzzy query. */
function findReceiveItemByQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const items = Array.isArray(state.masterItems) ? state.masterItems : [];
  const exactMatch = items.find((item) => String(item.name || '').toLowerCase() === normalized);
  if (exactMatch) {
    return exactMatch;
  }
  const partialMatch = items.find((item) => [
    item.name,
    item.type,
    item.unit,
    item.note,
    item.itemMasterId
  ].join(' ').toLowerCase().includes(normalized));
  return partialMatch || null;
}

/** Renders searchable receive suggestions. */
function renderReceiveItemSuggestions(query) {
  const root = document.getElementById('receiveItemResults');
  const normalized = String(query || '').trim().toLowerCase();
  const items = Array.isArray(state.masterItems) ? state.masterItems : [];
  if (!normalized) {
    root.classList.add('hidden');
    root.innerHTML = '';
    return;
  }

  const matches = items.filter((item) => [
    item.name,
    item.type,
    item.unit,
    item.note,
    item.itemMasterId
  ].join(' ').toLowerCase().includes(normalized)).slice(0, 10);

  if (!matches.length) {
    root.classList.remove('hidden');
    root.innerHTML = `
      <div class="px-4 py-3 text-sm text-slate-500">
        ไม่พบรายการที่ตรงกับ "${escapeHtml(query)}"
      </div>`;
    return;
  }

  root.classList.remove('hidden');
  root.innerHTML = matches.map((item) => `
    <button type="button" class="w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-teal-50/60" data-receive-item="${escapeHtml(item.name)}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-semibold text-slate-900">${escapeHtml(item.name)}</div>
          <div class="mt-1 text-xs text-slate-500">${escapeHtml([item.type, item.unit, item.note].filter(Boolean).join(' • ') || 'Master Data')}</div>
        </div>
        <span class="mini-pill bg-teal-100 text-teal-700">เลือก</span>
      </div>
    </button>
  `).join('');

  root.querySelectorAll('[data-receive-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = items.find((item) => item.name === button.dataset.receiveItem);
      if (selected) {
        selectReceiveItem(selected);
      }
    });
  });
}

/** Chooses a receive item and syncs both the search box and hidden select. */
function selectReceiveItem(item) {
  if (!item) {
    return;
  }
  const select = document.getElementById('receiveItemName');
  const searchInput = document.getElementById('receiveItemSearch');
  select.value = item.name;
  searchInput.value = item.name;
  const resultsRoot = document.getElementById('receiveItemResults');
  resultsRoot.classList.add('hidden');
  resultsRoot.innerHTML = '';
  refreshReceiveCodePreview();
}

/** Handles keyboard actions in the receive search box. */
function handleReceiveItemSearchKeydown(event) {
  const root = document.getElementById('receiveItemResults');
  if (event.key === 'Escape') {
    root.classList.add('hidden');
    root.innerHTML = '';
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const matched = findReceiveItemByQuery(event.target.value);
    if (matched) {
      selectReceiveItem(matched);
    }
  }
}

/** Updates suggestions while the receive search box changes. */
function handleReceiveItemSearch(value) {
  const matched = findReceiveItemByQuery(value);
  if (matched && String(matched.name || '').toLowerCase() === String(value || '').trim().toLowerCase()) {
    document.getElementById('receiveItemName').value = matched.name;
  } else {
    document.getElementById('receiveItemName').value = '';
  }
  renderReceiveItemSuggestions(value);
  refreshReceiveCodePreview();
}

/** Returns the currently selected receive master item, if any. */
function getSelectedReceiveItem() {
  const hiddenSelect = document.getElementById('receiveItemName');
  const searchValue = document.getElementById('receiveItemSearch').value.trim();
  const bySelect = (state.masterItems || []).find((item) => item.name === hiddenSelect.value);
  if (bySelect) {
    return bySelect;
  }
  if (!searchValue) {
    return null;
  }
  return (state.masterItems || []).find((item) => item.name.toLowerCase() === searchValue.toLowerCase()) || null;
}

/** Sets default dates for receive and dispatch forms. */
function setupDefaultDates() {
  const today = toDateInputValue(new Date());
  document.getElementById('receiveDate').value = today;
  document.getElementById('receiveSterileDate').value = today;
  document.getElementById('receiveExpireDate').value = addDaysToInputValue(new Date(), 30);
  document.getElementById('dispatchDate').value = today;
  document.getElementById('reportMonth').value = 'all';
}

/** Refreshes receive defaults after a reset or first load. */
function refreshReceiveDefaults() {
  if (!document.getElementById('receiveDate').value) {
    setupDefaultDates();
  }
  refreshReceiveCodePreview();
}

/** Renders the preview ItemCode for receive mode. */
async function refreshReceiveCodePreview() {
  const receiveDate = document.getElementById('receiveDate').value || toDateInputValue(new Date());
  const selectedItem = getSelectedReceiveItem();
  const itemName = selectedItem ? selectedItem.name : document.getElementById('receiveItemSearch').value.trim();
  document.getElementById('receiveItemCode').value = 'STK-กำลังสร้าง...';
  try {
    const itemCode = await apiCall('suggestItemCode', { receiveDate });
    document.getElementById('receiveItemCode').value = itemCode;
    renderReceivePreview({
      itemCode,
      itemName,
      receiveDate,
      sterileDate: document.getElementById('receiveSterileDate').value,
      expireDate: document.getElementById('receiveExpireDate').value,
      quantity: document.getElementById('receiveQuantity').value || 1
    });
  } catch (error) {
    document.getElementById('receiveItemCode').value = 'STK-...';
    showToast('warning', 'สร้างรหัสไม่สำเร็จ', getErrorMessage(error));
  }
}

/** Shows a receive preview in the side panel. */
function renderReceivePreview(item) {
  const preview = document.getElementById('receivePreviewCard');
  if (!item || !item.itemName) {
    renderReceivePreviewSkeleton();
    return;
  }
  preview.innerHTML = `
    <div class="space-y-3 text-slate-700">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-slate-900">${escapeHtml(item.itemCode)}</span>
        <span class="mini-pill bg-teal-100 text-teal-700">Preview</span>
      </div>
      <div class="rounded-2xl bg-white p-3 shadow-sm">
        <div class="text-base font-bold text-slate-900">${escapeHtml(item.itemName || '-')}</div>
        <div class="mt-2 grid grid-cols-2 gap-3 text-xs text-slate-500">
          <div><span class="font-semibold text-slate-700">รับเข้า:</span> ${formatThaiDate(item.receiveDate)}</div>
          <div><span class="font-semibold text-slate-700">นึ่ง:</span> ${formatThaiDate(item.sterileDate)}</div>
          <div><span class="font-semibold text-slate-700">หมดอายุ:</span> ${formatThaiDate(item.expireDate)}</div>
          <div><span class="font-semibold text-slate-700">จำนวน:</span> ${escapeHtml(item.quantity || '')}</div>
        </div>
      </div>
    </div>`;
}

/** Displays a skeleton card while the receive form is empty. */
function renderReceivePreviewSkeleton() {
  const preview = document.getElementById('receivePreviewCard');
  preview.innerHTML = `
    <div class="space-y-3">
      <div class="skeleton h-4 w-1/2 rounded"></div>
      <div class="skeleton h-24 rounded-2xl"></div>
      <div class="grid grid-cols-2 gap-3">
        <div class="skeleton h-12 rounded-2xl"></div>
        <div class="skeleton h-12 rounded-2xl"></div>
        <div class="skeleton h-12 rounded-2xl"></div>
        <div class="skeleton h-12 rounded-2xl"></div>
      </div>
    </div>`;
}

/** Handles receive submission, saves to backend and opens the label window. */
async function handleReceiveSubmit(event) {
  event.preventDefault();
  const selectedItem = getSelectedReceiveItem();
  if (!selectedItem) {
    showModal('กรุณาเลือกรายการ', '<p class="text-sm text-slate-600">พิมพ์คำค้นแล้วเลือกจากรายการที่แนะนำก่อนบันทึกรับเข้า</p>');
    return;
  }
  const payload = {
    receiveDate: document.getElementById('receiveDate').value,
    itemName: selectedItem.name,
    sterileDate: document.getElementById('receiveSterileDate').value,
    expireDate: document.getElementById('receiveExpireDate').value,
    quantity: document.getElementById('receiveQuantity').value,
    note: document.getElementById('receiveNote').value
  };
  const copies = Number(payload.quantity) || 0;
  showLoading(true);
  try {
    const response = await apiCall('receiveStock', payload);
    document.getElementById('receiveItemCode').value = response.item.itemCode;
    showToast('success', 'บันทึกรับเข้าแล้ว', response.message);
    const labelInfo = await apiCall('getLabelInfo', { itemCode: response.item.itemCode });
    openLabelPreviewModal(labelInfo.item, copies);
    await refreshDashboard(true);
    await refreshReports();
    resetReceiveForm(false);
    setupDefaultDates();
  } catch (error) {
    showModal('บันทึกรับเข้าไม่สำเร็จ', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`);
  } finally {
    showLoading(false);
  }
}

/** Resets the receive form but can preserve the preview code. */
function resetReceiveForm(withToast = true) {
  document.getElementById('receiveItemName').value = '';
  document.getElementById('receiveItemSearch').value = '';
  document.getElementById('receiveItemResults').innerHTML = '';
  document.getElementById('receiveItemResults').classList.add('hidden');
  document.getElementById('receiveQuantity').value = '';
  document.getElementById('receiveSterileDate').value = toDateInputValue(new Date());
  document.getElementById('receiveExpireDate').value = addDaysToInputValue(new Date(), 30);
  document.getElementById('receiveNote').value = '';
  if (withToast) {
    showToast('info', 'ล้างฟอร์มเรียบร้อย', 'ข้อมูลรับเข้าถูกรีเซ็ตเรียบร้อยแล้ว');
  }
  refreshReceiveCodePreview();
}

/** Marks the receive log as printed. */
async function markPrinted(itemCode) {
  try {
    await apiCall('markReceivePrinted', { itemCode });
  } catch (error) {
    console.warn('markReceivePrinted failed', error);
  }
}

/** Opens a friendly preview modal if the print window is blocked. */
function openLabelPreviewModal(item, copies) {
  showModal(`บันทึกรับเข้าเสร็จแล้ว`, `
    <div class="space-y-4">
      <div class="rounded-2xl bg-slate-50 p-4">
        <div class="font-bold text-slate-900">${escapeHtml(item.name)}</div>
        <div class="mt-2 text-sm text-slate-600">ItemCode: ${escapeHtml(item.itemCode)}<br>จำนวนสติกเกอร์: ${escapeHtml(copies)}<br>สติกเกอร์มี QR Code ขนาดใหญ่ด้านขวา และข้อมูลรายการด้านซ้าย</div>
      </div>
      <div class="text-sm text-slate-500">กดปุ่มด้านล่างเมื่อพร้อมพิมพ์สติกเกอร์</div>
    </div>`, {
    primaryLabel: 'พิมพ์สติกเกอร์',
    secondaryLabel: 'ปิด',
    onPrimary: async () => {
      const win = window.open('', '_blank', 'width=520,height=700');
      if (!win || win.closed) {
        showToast('warning', 'เปิดหน้าพิมพ์ไม่สำเร็จ', 'เบราว์เซอร์อาจบล็อกหน้าต่างป๊อปอัป');
        return;
      }
      renderLabelWindow(win, item, copies);
      await markPrinted(item.itemCode);
      closeModal();
    }
  });
}

/** Creates a thermal-label document in a new window and prints it. */
function renderLabelWindow(printWindow, item, copies) {
  const copiesCount = Math.max(1, Number(copies) || 1);
  if (!printWindow || printWindow.closed) {
    openLabelPreviewModal(item, copiesCount);
    return;
  }
  const labels = Array.from({ length: copiesCount }).map((_, index) => `
    <div class="label-sheet">
      <div class="label-card label-card-item">
        <div class="label-info">
          <div class="label-caption">Sterile STOCK</div>
          <div class="item-code">${escapeHtml(item.itemCode)}</div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-expire">หมดอายุ: ${formatThaiDate(item.expireDate)}</div>
          <div class="warning-banner">หยิบใช้กรุณาตัดจ่ายในระบบ</div>
        </div>
        <div class="qr-panel">
          <div id="qr-${index}" class="qr-code"></div>
        </div>
      </div>
    </div>`).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Print Label</title>
      <style>
        @page { size: 2in 1in; margin: 0; }
        html, body { width: 2in; height: 1in; margin: 0; padding: 0; overflow: hidden; font-family: Arial, sans-serif; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .label-sheet { width: 2in; height: 1in; page-break-after: always; page-break-inside: avoid; }
        .label-card { width: 2in; height: 1in; box-sizing: border-box; padding: 0.05in; }
        .label-card-item { display: grid; grid-template-columns: 1.05in 0.82in; gap: 0.04in; align-items: center; }
        .label-info { min-width: 0; height: 0.9in; display: flex; flex-direction: column; justify-content: space-between; }
        .label-caption { font-size: 4.7pt; font-weight: 800; color: #0f766e; line-height: 1; letter-spacing: 0; }
        
        .item-code { font-size: 6.8pt; font-weight: 900; word-break: break-all; line-height: 1.1; max-height: 0.25in; overflow: hidden; }
        .item-name { font-size: 6.1pt; font-weight: 800; line-height: 1.08; max-height: 0.25in; overflow: hidden; }
        .item-expire { font-size: 5.8pt; color: #0f766e; font-weight: 800; line-height: 1; }
        .warning-banner { padding: 0.025in 0.03in; border-radius: 0.05in; border: 1px solid #fb923c; background: #fff7ed; color: #9a3412; font-size: 6.8pt; line-height: 1.08; font-weight: 900; text-align: center; }
        .qr-panel { width: 0.82in; height: 0.9in; display: flex; align-items: center; justify-content: center; }
        .qr-code, .qr-code img, .qr-code canvas { width: 0.78in !important; height: 0.78in !important; display: block; }
      </style>
    </head>
    <body>
      ${labels}
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
      <script>
        window.addEventListener('load', () => {
          ${Array.from({ length: copiesCount }).map((_, index) => `
            new QRCode(document.getElementById('qr-${index}'), {
              text: ${JSON.stringify(item.itemCode)},
              width: 148,
              height: 148,
              correctLevel: QRCode.CorrectLevel.L
            });
          `).join('')}
          setTimeout(() => {
            window.focus();
            window.print();
            window.onafterprint = () => window.close();
          }, 350);
        });
      <\/script>
    </body>
    </html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

/** ฟังก์ชันสำหรับพิมพ์หลายรายการพร้อมกัน (เพิ่มใหม่) */
function printBatchLabels(selectedItems) {
  let printWindow = state.labelWindow;
  if (!printWindow || printWindow.closed) {
    printWindow = window.open('', 'PrintWindow', 'width=800,height=600');
    state.labelWindow = printWindow;
  }

  let allLabelsHtml = '';
  let qrScripts = '';
  let qrIndex = 0;

  selectedItems.forEach(({ item, copies }) => {
    const labels = Array.from({ length: copies }).map(() => {
      const currentQrIndex = qrIndex++;
      qrScripts += `
        new QRCode(document.getElementById('qr-${currentQrIndex}'), {
          text: ${JSON.stringify(item.itemCode)},
          width: 148, height: 148,
          correctLevel: QRCode.CorrectLevel.L
        });
      `;
      return `
        <div class="label-sheet">
          <div class="label-card label-card-item">
            <div class="label-info">
              <div class="label-caption">Sterile STOCK</div>
              <div class="item-code">${escapeHtml(item.itemCode)}</div>
              <div class="item-name">${escapeHtml(item.name)}</div>
              <div class="item-expire">หมดอายุ: ${formatThaiDate(item.expireDate)}</div>
              <div class="warning-banner">หยิบใช้กรุณาตัดจ่ายในระบบ</div>
            </div>
            <div class="qr-panel">
              <div id="qr-${currentQrIndex}" class="qr-code"></div>
            </div>
          </div>
        </div>`;
    }).join('');
    allLabelsHtml += labels;
  });

  const html = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>Print Batch Labels</title>
      <style>
        @page { size: 2in 1in; margin: 0; }
        html, body { width: 2in; height: 1in; margin: 0; padding: 0; overflow: hidden; font-family: Arial, sans-serif; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .label-sheet { width: 2in; height: 1in; page-break-after: always; page-break-inside: avoid; }
        .label-card { width: 2in; height: 1in; box-sizing: border-box; padding: 0.05in; }
        .label-card-item { display: grid; grid-template-columns: 1.05in 0.82in; gap: 0.04in; align-items: center; }
        .label-info { min-width: 0; height: 0.9in; display: flex; flex-direction: column; justify-content: space-between; }
        .label-caption { font-size: 4.7pt; font-weight: 800; color: #0f766e; line-height: 1; letter-spacing: 0; }
        .item-code { font-size: 6.8pt; font-weight: 900; word-break: break-all; line-height: 1.1; max-height: 0.25in; overflow: hidden; }
        .item-name { font-size: 6.1pt; font-weight: 800; line-height: 1.08; max-height: 0.25in; overflow: hidden; }
        .item-expire { font-size: 5.8pt; color: #0f766e; font-weight: 800; line-height: 1; }
        .warning-banner { padding: 0.025in 0.03in; border-radius: 0.05in; border: 1px solid #fb923c; background: #fff7ed; color: #9a3412; font-size: 6.8pt; line-height: 1.08; font-weight: 900; text-align: center; }
        .qr-panel { width: 0.82in; height: 0.9in; display: flex; align-items: center; justify-content: center; }
        .qr-code, .qr-code img, .qr-code canvas { width: 0.78in !important; height: 0.78in !important; display: block; }
      </style>
    </head>
    <body>
      ${allLabelsHtml}
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
      <script>
        window.addEventListener('load', () => {
          ${qrScripts}
          setTimeout(() => {
            window.focus();
            window.print();
            window.onafterprint = () => window.close();
          }, 500);
        });
      <\/script>
    </body>
    </html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

/** Populates dashboard cards and refreshes the stock table. */
async function refreshDashboard(forcePageLoad) {
  if (!state.bootstrap) return;
  if (forcePageLoad) {
    await refreshStockPage(true);
  } else {
    renderDashboardMetrics(state.metrics || state.bootstrap.dashboard);
  }
}

/** Loads dashboard metrics and stock rows from the server. */
async function refreshStockPage(forceReload = false) {
  showLoading(true);
  try {
    const payload = await apiCall('getDashboardData', {
      page: state.filters.page,
      pageSize: state.filters.pageSize,
      query: state.filters.query,
      status: state.filters.status,
      date: state.filters.date, // ส่งข้อมูลตัวกรองวันที่
      sortField: state.sort.field,
      sortDirection: state.sort.direction,
      fiscalYearStart: state.report.fiscalYearStart,
      month: state.report.month
    });
    state.metrics = payload.dashboard;
    state.stockPage = payload.stockPage;
    state.summary = payload.summary;
    state.bootstrap = { ...(state.bootstrap || {}), ...payload };
    renderDashboardMetrics(payload.dashboard);
    renderStockPage(payload.stockPage);
  } catch (error) {
    showModal('โหลดข้อมูลคงคลังไม่สำเร็จ', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`);
  } finally {
    showLoading(false);
  }
}

/** Renders the six dashboard metric cards. */
function renderDashboardMetrics(metrics) {
  const root = document.getElementById('dashboardMetrics');
  if (!metrics) {
    root.innerHTML = skeletonMetricMarkup();
    return;
  }

  const cards = [
    { key: 'normal', label: 'คงคลังปกติ', value: metrics.normal, icon: 'inventory_2', color: 'status-normal' },
    { key: 'expiredToday', label: 'หมดอายุวันนี้', value: metrics.expiredToday, icon: 'today', color: 'status-expiredToday' },
    { key: 'expiring3', label: 'ใกล้หมดอายุ 3 วัน', value: metrics.expiring3, icon: 'schedule', color: 'status-expiring3' },
    { key: 'expiring2', label: 'ใกล้หมดอายุ 2 วัน', value: metrics.expiring2, icon: 'schedule', color: 'status-expiring2' },
    { key: 'expiring1', label: 'ใกล้หมดอายุ 1 วัน', value: metrics.expiring1, icon: 'schedule', color: 'status-expiring1' },
    { key: 'expired', label: 'หมดอายุแล้ว', value: metrics.expired, icon: 'warning', color: 'status-expired' }
  ];

  root.innerHTML = cards.map((card) => `
    <button class="metric-card glass-card rounded-3xl p-4 text-left" data-status-key="${card.key}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-slate-500">${escapeHtml(card.label)}</div>
          <div class="mt-3 text-3xl font-black text-slate-900">${formatNumber(card.value)}</div>
        </div>
        <div class="mini-pill ${card.color}">
          <span class="material-symbols-rounded text-sm">${card.icon}</span>
        </div>
      </div>
    </button>`).join('');

  root.querySelectorAll('[data-status-key]').forEach((button) => {
    button.addEventListener('click', () => openStatusDetailModal(button.dataset.statusKey));
  });
}

/** Renders the stock table rows and pagination controls. */
function renderStockPage(page) {
  const tbody = document.getElementById('stockTableBody');
  if (!page || !page.items || !page.items.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-sm text-slate-500">ไม่พบข้อมูลคงคลัง</td></tr>`;
    return;
  }

  // เผื่อกรณีฝั่ง Backend ยังไม่รองรับการกรองด้วย Date จะทำการ Filter ฝั่ง Client ทับอีกชั้นเพื่อความชัวร์
  let displayItems = page.items;
  if (state.filters.date) {
    displayItems = displayItems.filter(item => {
      if (!item.receiveDate) return false;
      const itemDate = new Date(item.receiveDate).toISOString().split('T')[0];
      return itemDate === state.filters.date;
    });
  }

  if (displayItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-10 text-center text-sm text-slate-500">ไม่พบรายการที่ตรงกับวันที่ระบุ</td></tr>`;
    return;
  }

  tbody.innerHTML = displayItems.map((item) => {
    const statusClass = statusClassName(item.statusKey || item.status);
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50/80">
        <td class="px-4 py-3 w-10 text-center">
          <input type="checkbox" class="stock-checkbox rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer w-4 h-4" value="${escapeHtml(item.itemCode)}" data-qty="${item.quantity}">
        </td>
        <td class="px-4 py-3 font-semibold text-slate-900">${escapeHtml(item.itemCode)}</td>
        <td class="px-4 py-3">${escapeHtml(item.name)}</td>
        <td class="px-4 py-3">${formatThaiDate(item.receiveDate)}</td>
        <td class="px-4 py-3">${formatThaiDate(item.sterileDate)}</td>
        <td class="px-4 py-3">${formatThaiDate(item.expireDate)}</td>
        <td class="px-4 py-3 text-right font-semibold">${formatNumber(item.quantity)}</td>
        <td class="px-4 py-3"><span class="status-badge ${statusClass}">${escapeHtml(item.status)}</span></td>
        <td class="px-4 py-3 text-right">
          <div class="flex justify-end gap-2">
            <button class="btn-secondary !px-3 !py-2 text-xs" data-action="reprint" data-code="${escapeHtml(item.itemCode)}">พิมพ์ย้อนหลัง</button>
            <button class="btn-primary !px-3 !py-2 text-xs" data-action="dispatch" data-code="${escapeHtml(item.itemCode)}">ตัดจ่าย</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-action="reprint"]').forEach((button) => {
    button.addEventListener('click', () => openReprintModal(button.dataset.code));
  });
  tbody.querySelectorAll('[data-action="dispatch"]').forEach((button) => {
    button.addEventListener('click', () => {
      switchView('dispatch');
      selectDispatchByCode(button.dataset.code);
    });
  });

  // รีเซ็ตการเลือกทั้งหมดทุกครั้งที่มีการ Render ตารางใหม่
  const selectAllCb = document.getElementById('selectAllStock');
  if(selectAllCb) selectAllCb.checked = false;

  renderPagination(page);
}

/** Renders pagination buttons for the dashboard table. */
function renderPagination(page) {
  const root = document.getElementById('stockPagination');
  if (!page || !page.total) {
    root.innerHTML = `<div class="text-sm text-slate-500">ไม่มีข้อมูลที่แสดง</div>`;
    return;
  }
  const start = ((page.page - 1) * page.pageSize) + 1;
  const end = Math.min(page.total, page.page * page.pageSize);
  root.innerHTML = `
    <div class="text-sm text-slate-500">แสดง ${start}-${end} จาก ${page.total} รายการ</div>
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-secondary !px-3 !py-2 text-sm" id="prevPageBtn" ${page.page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
      <span class="text-sm font-semibold text-slate-700">หน้า ${page.page} / ${page.totalPages}</span>
      <button class="btn-secondary !px-3 !py-2 text-sm" id="nextPageBtn" ${page.page >= page.totalPages ? 'disabled' : ''}>ถัดไป</button>
    </div>`;
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    state.filters.page = Math.max(1, state.filters.page - 1);
    refreshStockPage(true);
  });
  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    state.filters.page = Math.min(page.totalPages, state.filters.page + 1);
    refreshStockPage(true);
  });
  document.querySelectorAll('.metric-card').forEach((card) => {
    card.addEventListener('click', () => openStatusDetailModal(card.dataset.statusKey));
  });
}

/** Opens a status modal and allows dispatching from inside the list. */
async function openStatusDetailModal(statusKey) {
  showLoading(true);
  try {
    const rows = await apiCall('getStockByStatus', { statusKey });
    const titleMap = {
      normal: 'รายชื่อสถานะปกติ',
      expiredToday: 'รายการหมดอายุวันนี้',
      expiring3: 'รายการใกล้หมดอายุ 3 วัน',
      expiring2: 'รายการใกล้หมดอายุ 2 วัน',
      expiring1: 'รายการใกล้หมดอายุ 1 วัน',
      expired: 'รายการหมดอายุแล้ว'
    };
    const body = rows.length
      ? `
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div class="text-sm text-slate-500">พบ ${rows.length} รายการ</div>
            <div class="chip">${escapeHtml(titleMap[statusKey] || statusKey)}</div>
          </div>
          <div class="space-y-3 modal-body-scroll">
            ${rows.map((row) => `
              <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div class="text-sm font-bold text-slate-900">${escapeHtml(row.itemCode)} • ${escapeHtml(row.name)}</div>
                    <div class="mt-1 text-xs text-slate-500">หมดอายุ ${formatThaiDate(row.expireDate)} • คงเหลือ ${formatNumber(row.quantity)} • ${escapeHtml(row.status)}</div>
                  </div>
                  <button class="btn-danger !px-4 !py-2 text-sm" data-modal-dispatch="${escapeHtml(row.itemCode)}">ตัดจ่ายออก</button>
                </div>
              </div>`).join('')}
          </div>
        </div>`
      : `<div class="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">ไม่พบรายการในสถานะนี้</div>`;

    showModal(titleMap[statusKey] || 'รายละเอียดรายการ', body, {
      hideFooter: true
    });
    document.querySelectorAll('[data-modal-dispatch]').forEach((button) => {
      button.addEventListener('click', () => {
        const itemCode = button.dataset.modalDispatch;
        closeModal();
        switchView('dispatch');
        selectDispatchByCode(itemCode);
      });
    });
  } catch (error) {
    showModal('โหลดข้อมูลไม่สำเร็จ', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`);
  } finally {
    showLoading(false);
  }
}

/** Opens the reprint modal and prints the original label quantity by default. */
async function openReprintModal(itemCode) {
  showLoading(true);
  try {
    const response = await apiCall('getLabelInfo', { itemCode });
    const item = response.item;
    showModal(`พิมพ์ย้อนหลัง ${escapeHtml(item.itemCode)}`, `
      <div class="space-y-4">
        <div class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <div class="font-bold text-slate-900">${escapeHtml(item.name)}</div>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <div>รับเข้า: ${formatThaiDate(item.receiveDate)}</div>
            <div>หมดอายุ: ${formatThaiDate(item.expireDate)}</div>
            <div>จำนวนรับ: ${formatNumber(item.quantity)}</div>
            <div>คงเหลือ: ${formatNumber(item.remaining)}</div>
          </div>
        </div>
        <label class="block text-sm font-semibold text-slate-700">จำนวนดวงที่ต้องการพิมพ์</label>
        <input id="reprintCopiesInput" class="field" type="number" min="1" step="1" value="${Math.max(1, item.quantity || 1)}">
      </div>`, {
      primaryLabel: 'พิมพ์',
      secondaryLabel: 'ปิด',
      onPrimary: () => {
        const copies = Number(document.getElementById('reprintCopiesInput').value) || 1;
        const win = window.open('', '_blank', 'width=520,height=700');
        renderLabelWindow(win, item, copies);
        closeModal();
      }
    });
  } catch (error) {
    showModal('พิมพ์ย้อนหลังไม่สำเร็จ', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`);
  } finally {
    showLoading(false);
  }
}

/** Loads a dispatch lookup and fills the right-side form. */
async function handleDispatchSearch() {
  const query = document.getElementById('dispatchSearchInput').value.trim();
  const resultsRoot = document.getElementById('dispatchSearchResults');
  if (!query) {
    resultsRoot.innerHTML = '';
    return;
  }
  showLoading(true);
  try {
    const results = await apiCall('searchStock', { query });
    if (!results.length) {
    resultsRoot.innerHTML = `<div class="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">ไม่พบรายการที่ตรงกับ "${escapeHtml(query)}"</div>`;
      return;
    }
    resultsRoot.innerHTML = results.map((row) => `
      <button class="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-300 hover:bg-teal-50/40" data-search-select="${escapeHtml(row.itemCode)}">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-bold text-slate-900">${escapeHtml(row.name)}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(row.itemCode)} • คงเหลือ ${formatNumber(row.quantity)} • หมดอายุ ${formatThaiDate(row.expireDate)}</div>
          </div>
          <span class="status-badge ${statusClassName(row.statusKey)}">${escapeHtml(row.status)}</span>
        </div>
      </button>`).join('');
    resultsRoot.querySelectorAll('[data-search-select]').forEach((button) => {
      button.addEventListener('click', () => selectDispatchByCode(button.dataset.searchSelect));
    });
    if (results.length === 1) {
      selectDispatchByCode(results[0].itemCode);
    }
  } catch (error) {
    showToast('error', 'ค้นหาไม่สำเร็จ', getErrorMessage(error));
  } finally {
    showLoading(false);
  }
}

/** Selects a dispatch item and fills the form with its information. */
async function selectDispatchByCode(itemCode) {
  if (!itemCode) {
    resetDispatchPanel();
    return;
  }
  const results = await apiCall('searchStock', { query: itemCode });
  const item = results.find((row) => row.itemCode === itemCode) || results[0];
  if (!item) {
    showToast('warning', 'ไม่พบรายการ', 'รายการที่ค้นหาอาจถูกตัดจ่ายหรือไม่มีอยู่ในคลัง');
    return;
  }
  selectDispatchItem(item);
}

/** Fills the dispatch selection card and hidden item code. */
function selectDispatchItem(item) {
  const selectedCard = document.getElementById('dispatchSelectedCard');
  if (!item) {
    resetDispatchPanel();
    return;
  }
  document.getElementById('dispatchItemCode').value = item.itemCode;
  selectedCard.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-lg font-bold text-slate-900">${escapeHtml(item.name)}</div>
          <div class="text-sm text-slate-500">${escapeHtml(item.itemCode)}</div>
        </div>
        <span class="status-badge ${statusClassName(item.statusKey)}">${escapeHtml(item.status)}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-2xl bg-white p-3 shadow-sm"><div class="text-xs text-slate-500">จำนวนคงเหลือ</div><div class="text-lg font-bold">${formatNumber(item.quantity)}</div></div>
        <div class="rounded-2xl bg-white p-3 shadow-sm"><div class="text-xs text-slate-500">วันหมดอายุ</div><div class="text-lg font-bold">${formatThaiDate(item.expireDate)}</div></div>
      </div>
    </div>`;
  document.getElementById('dispatchQuantity').focus();
}

/** Resets the dispatch panel and clears search results. */
function resetDispatchPanel() {
  document.getElementById('dispatchItemCode').value = '';
  document.getElementById('dispatchSelectedCard').innerHTML = `<div class="text-center text-slate-400">กรอกรายการด้านบนเพื่อค้นหา</div>`;
  document.getElementById('dispatchSearchResults').innerHTML = '';
  document.getElementById('dispatchSearchInput').value = '';
  document.getElementById('dispatchQuantity').value = '';
  document.getElementById('dispatchType').value = '';
  document.getElementById('dispatchNote').value = '';
  document.getElementById('dispatchDate').value = toDateInputValue(new Date());
}

/** Handles dispatch submission and updates stock state. */
async function handleDispatchSubmit(event) {
  event.preventDefault();
  const payload = {
    itemCode: document.getElementById('dispatchItemCode').value,
    dispatchDate: document.getElementById('dispatchDate').value,
    quantity: document.getElementById('dispatchQuantity').value,
    dispatchType: document.getElementById('dispatchType').value,
    note: document.getElementById('dispatchNote').value
  };
  showLoading(true);
  try {
    const response = await apiCall('dispatchStock', payload);
    showToast('success', 'จ่ายออกสำเร็จ', response.message);
    resetDispatchPanel();
    await refreshDashboard(true);
    await refreshReports();
    if (response.deleted) {
      showToast('info', 'Stock ถูกลบออก', 'จำนวนคงเหลือเป็น 0 ระบบลบรายการออกจาก Stock แล้ว');
    }
  } catch (error) {
    showModal('จ่ายออกไม่สำเร็จ', `<p class="text-sm text-slate-600">${escapeHtml(getErrorMessage(error))}</p>`);
  } finally {
    showLoading(false);
  }
}

/** Opens the production barcode scanner modal. */
async function openScannerModal() {
  if (window.SterileBarcodeScanner?.open) {
    await window.SterileBarcodeScanner.open({
      initialFacingMode: 'environment',
      onDetected: async (code) => {
        document.getElementById('dispatchSearchInput').value = code;
        await handleDispatchSearch();
      },
      onClose: () => {
        state.scanner.active = false;
      }
    });
    return;
  }

  showModal(
    'สแกนบาร์โค้ด',
    `
      <div class="space-y-4">
        <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          โมดูลสแกนเนอร์ยังไม่ถูกโหลด กรุณารีเฟรชหน้าเว็บ หรือใช้ช่องค้นหา/เครื่องยิงบาร์โค้ดแบบคีย์บอร์ดแทน
        </div>
        <button class="btn-secondary w-full" type="button" onclick="location.reload()">รีเฟรชหน้าเว็บ</button>
      </div>
    `,
    { hideFooter: true }
  );
}

/** Loads and renders summary analytics. */
async function refreshReports() {
  if (!document.getElementById('view-reports')) return;
  const fiscalYearSelect = document.getElementById('reportFiscalYear');
  if (!fiscalYearSelect.value) {
    populateFiscalYearSelect();
  }
  const fiscalYearStart = Number(fiscalYearSelect.value) || guessCurrentFiscalYearStart();
  const month = document.getElementById('reportMonth').value || 'all';
  state.report = { fiscalYearStart, month };

  showLoading(true);
  try {
    const canReuseBootstrapSummary = state.bootstrap
      && state.bootstrap.summary
      && Number(state.bootstrap.summary.fiscalYearStart) === Number(fiscalYearStart)
      && String(month || 'all') === 'all';
    const summary = canReuseBootstrapSummary
      ? state.bootstrap.summary
      : await apiCall('getSummaryData', { fiscalYearStart, month });
    renderSummaryStats(summary.cards);
    renderSummaryCharts(summary.chart);
    renderSummaryTable(summary.detailRows || []);
    document.getElementById('reportRangeLabel').textContent = `${summary.fiscalYearLabel} | ${summary.startDate} - ${summary.endDate}`;
    state.summary = summary;
  } catch (error) {
    showToast('error', 'โหลดรายงานไม่สำเร็จ', getErrorMessage(error));
  } finally {
    showLoading(false);
  }
}
/** Populates the fiscal year selector with a few current options. */
function populateFiscalYearSelect() {
  const select = document.getElementById('reportFiscalYear');
  const currentStart = guessCurrentFiscalYearStart();
  const options = [currentStart - 2, currentStart - 1, currentStart, currentStart + 1];
  select.innerHTML = options.map((year) => `<option value="${year}">FY ${year + 543}</option>`).join('');
  select.value = String(currentStart);
}

/** Infers the current fiscal year start year from today's date. */
function guessCurrentFiscalYearStart() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Renders analytics statistic cards. */
function renderSummaryStats(cards) {
  const root = document.getElementById('reportStats');
  if (!cards) {
    root.innerHTML = skeletonMetricMarkup();
    return;
  }

  const items = [
    { label: 'Re-Sterile', value: cards.resterileCount, rate: cards.resterileRate, color: 'from-cyan-500 to-sky-500' },
    { label: 'หมุนเวียนไปตึกอื่น', value: cards.rotationCount, rate: cards.rotationRate, color: 'from-teal-500 to-emerald-500' },
    { label: 'หมดอายุ', value: cards.expiredCount, rate: null, color: 'from-rose-500 to-red-500' },
    { label: 'สูญเสีย', value: cards.lossCount, rate: null, color: 'from-amber-500 to-orange-500' }
  ];

  root.innerHTML = items.map((item) => `
    <div class="glass-card rounded-3xl p-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-slate-500">${escapeHtml(item.label)}</div>
          <div class="mt-3 text-3xl font-black text-slate-900">${formatNumber(item.value)}</div>
        </div>
        <div class="h-12 w-12 rounded-2xl bg-gradient-to-br ${item.color}"></div>
      </div>
      ${item.rate != null ? `
        <div class="mt-4">
          <div class="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>สัดส่วน</span>
            <span>${formatPercent(item.rate)}</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-gradient-to-r ${item.color}" style="width:${Math.min(100, item.rate)}%"></div>
          </div>
        </div>` : ''}
    </div>`).join('');
}

/** Renders the summary charts with Chart.js. */
function renderSummaryCharts(chartData) {
  if (!chartData) return;
  destroyCharts();
  const barCtx = document.getElementById('chartBar');
  const lineCtx = document.getElementById('chartLine');
  const pieCtx = document.getElementById('chartPie');

  state.charts.bar = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: [
        { label: 'ใช้งาน', data: chartData.bar.use, backgroundColor: 'rgba(14, 165, 233, 0.8)', borderRadius: 8 },
        { label: 'หมุนเวียน', data: chartData.bar.rotation, backgroundColor: 'rgba(20, 184, 166, 0.8)', borderRadius: 8 },
        { label: 'Re-Sterile', data: chartData.bar.resterile, backgroundColor: 'rgba(59, 130, 246, 0.8)', borderRadius: 8 },
        { label: 'สูญเสีย', data: chartData.bar.loss, backgroundColor: 'rgba(249, 115, 22, 0.8)', borderRadius: 8 }
      ]
    },
    options: chartOptions('bar')
  });

  state.charts.line = new Chart(lineCtx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: 'จำนวนครั้ง',
        data: chartData.line,
        fill: true,
        tension: 0.35,
        borderColor: '#0f766e',
        backgroundColor: 'rgba(14, 165, 233, 0.12)'
      }]
    },
    options: chartOptions('line')
  });

  state.charts.pie = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: chartData.pie.labels,
      datasets: [{
        data: chartData.pie.values,
        backgroundColor: ['#0ea5e9', '#14b8a6', '#6366f1', '#f97316'],
        borderWidth: 0
      }]
    },
    options: {
      ...chartOptions('pie'),
      cutout: '68%'
    }
  });
}

/** Renders the summary detail table. */
function renderSummaryTable(rows) {
  const root = document.getElementById('reportTableBody');
  if (!rows.length) {
    root.innerHTML = `<tr><td colspan="6" class="px-4 py-10 text-center text-sm text-slate-500">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>`;
    return;
  }
  root.innerHTML = rows.map((row) => `
    <tr class="border-b border-slate-100 hover:bg-slate-50/80">
      <td class="px-4 py-3 font-semibold text-slate-900">${escapeHtml(row.itemCode)}</td>
      <td class="px-4 py-3">${escapeHtml(row.name)}</td>
      <td class="px-4 py-3">${formatThaiDate(row.date)}</td>
      <td class="px-4 py-3 text-right font-semibold">${formatNumber(row.quantity)}</td>
      <td class="px-4 py-3">${escapeHtml(row.type)}</td>
      <td class="px-4 py-3">${escapeHtml(row.note || '-')}</td>
    </tr>`).join('');
}

/** Exports the summary report as a CSV file. */
async function exportSummaryExcelLike(event) {
  event.preventDefault();
  try {
    const response = await apiCall('exportSummaryCsv', state.report);
    downloadTextFile(response.csv, response.fileName, 'text/csv;charset=utf-8;');
    showToast('success', 'ส่งออกรายงานสำเร็จ', 'ไฟล์ CSV พร้อมเปิดใน Excel แล้ว');
  } catch (error) {
    showToast('error', 'ส่งออกรายงานไม่สำเร็จ', getErrorMessage(error));
  }
}

/** Prints the summary section, which can also be saved as PDF by the browser. */
function printSummaryReport() {
  document.body.classList.add('print-summary-mode');
  setTimeout(() => {
    window.print();
    setTimeout(() => document.body.classList.remove('print-summary-mode'), 700);
  }, 120);
}

/** Registers the service worker and exposes the install button when possible. */
function registerPwa() {
  if ('serviceWorker' in navigator) {
    const isGasHost = window.location.hostname.includes('script.google.com');
    const swUrl = isGasHost ? `${window.location.origin}${window.location.pathname}?asset=sw` : 'service-worker.js';
    navigator.serviceWorker.register(swUrl).catch((error) => console.warn('SW register failed', error));
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    const button = document.getElementById('installPwaBtn');
    button.classList.remove('hidden');
    button.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.classList.add('hidden');
    }, { once: true });
  });
}

/** Tries to prompt the browser PWA install flow. */
async function installPwaPrompt() {
  showToast('info', 'ติดตั้ง PWA', 'หากเบราว์เซอร์รองรับ ระบบจะแสดงหน้าติดตั้งให้');
}

/** Removes and recreates the chart instances. */
function destroyCharts() {
  Object.values(state.charts).forEach((chart) => chart?.destroy?.());
  state.charts = {};
}

/** Shows or hides the loading overlay. */
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
  document.getElementById('loadingOverlay').classList.toggle('flex', !!show);
}

/** Displays a toast notification. */
function showToast(type, title, message) {
  const root = document.getElementById('toastRoot');
  if (!root.classList.contains('toast-stack')) {
    root.className = 'toast-stack no-print';
  }
  const colorMap = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800'
  };
  const el = document.createElement('div');
  el.className = `toast-item ${colorMap[type] || colorMap.info}`;
  el.innerHTML = `
    <div class="flex items-start gap-3">
      <span class="material-symbols-rounded mt-0.5 text-lg">${toastIcon(type)}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-bold">${escapeHtml(title)}</div>
        <div class="mt-1 text-xs leading-5 opacity-90">${escapeHtml(message)}</div>
      </div>
    </div>`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/** Shows the global modal dialog. */
function showModal(title, bodyHtml, options = {}) {
  const root = document.getElementById('modalRoot');
  const hideFooter = Boolean(options.hideFooter);
  root.innerHTML = `
    <div id="modalBackdrop" class="fixed inset-0 z-40 modal-backdrop"></div>
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="glass-card modal-panel w-full ${modalWidthClass(options.size)} rounded-3xl">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 class="text-lg font-bold text-slate-900">${escapeHtml(title)}</h3>
          </div>
          <button id="modalCloseBtn" class="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div class="modal-body-scroll px-5 py-5">${bodyHtml}</div>
        ${hideFooter ? '' : `
          <div class="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
            <button id="modalSecondaryBtn" class="btn-secondary">${escapeHtml(options.secondaryLabel || 'ปิด')}</button>
            <button id="modalPrimaryBtn" class="btn-primary">${escapeHtml(options.primaryLabel || 'ตกลง')}</button>
          </div>`}
      </div>
    </div>`;
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  if (!hideFooter) {
    const primaryBtn = document.getElementById('modalPrimaryBtn');
    const secondaryBtn = document.getElementById('modalSecondaryBtn');
    primaryBtn.addEventListener('click', () => {
      if (typeof options.onPrimary === 'function') {
        options.onPrimary();
      } else {
        closeModal();
      }
    });
    secondaryBtn.addEventListener('click', () => {
      if (typeof options.onSecondary === 'function') {
        options.onSecondary();
      }
      closeModal();
    });
  }
  state.modal = { title };
}

/** Closes the active modal dialog. */
function closeModal() {
  window.SterileBarcodeScanner?.close?.();
  document.getElementById('modalRoot').innerHTML = '';
  state.modal = null;
}

/** Returns the correct modal width class. */
function modalWidthClass(size) {
  switch ((size || 'md').toLowerCase()) {
    case 'xl': return 'max-w-6xl';
    case 'lg': return 'max-w-4xl';
    case 'sm': return 'max-w-xl';
    default: return 'max-w-2xl';
  }
}

/** Wraps google.script.run into a Promise-based API. */
function apiCall(method, payload = {}) {
  const canUseGasRun = typeof google !== 'undefined' && google.script && google.script.run && window.location.hostname.includes('script.google.com');
  if (canUseGasRun) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler((response) => {
          if (response && response.ok === false) {
            reject(new Error(response.error || 'เกิดข้อผิดพลาด'));
            return;
          }
          resolve(response && response.data !== undefined ? response.data : response);
        })
        .withFailureHandler(reject)[method](payload);
    });
  }
  if (!GAS_API_URL) {
    return Promise.reject(new Error('ไม่พบ GAS API URL'));
  }
  return jsonpRequest(method, payload);
}

/** Calls the GAS backend through JSONP so GitHub Pages can read the response. */
function jsonpRequest(method, payload) {
  return new Promise((resolve, reject) => {
    const callbackName = `sterileStockCb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const script = document.createElement('script');
    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (response) => {
      cleanup();
      if (!response || response.ok === false) {
        reject(new Error((response && response.error) || 'เกิดข้อผิดพลาดจาก API'));
        return;
      }
      resolve(response.data);
    };

    const params = new URLSearchParams({
      action: method,
      payload: JSON.stringify(payload || {}),
      callback: callbackName
    });
    script.src = `${GAS_API_URL}?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error('ไม่สามารถเรียก GAS API ได้'));
    };
    document.head.appendChild(script);
  });
}

/** Extracts a human readable error message. */
function getErrorMessage(error) {
  const raw = error && error.message ? error.message : String(error || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  return raw.replace(/^VALIDATION:/, '');
}

/** Escapes HTML to protect template rendering. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formats dates into Thai Buddhist calendar format. */
function formatThaiDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok'
  }).format(date).replace(',', '');
}

/** Formats numeric values safely. */
function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('th-TH').format(number);
}

/** Formats percentages with one decimal place. */
function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(1)}%`;
}

/** Maps a status key to the badge class name. */
function statusClassName(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('expiredtoday')) return 'status-expiredToday';
  if (normalized.includes('expiring1')) return 'status-expiring1';
  if (normalized.includes('expiring2')) return 'status-expiring2';
  if (normalized.includes('expiring3')) return 'status-expiring3';
  if (normalized.includes('expired')) return 'status-expired';
  if (normalized.includes('empty')) return 'status-empty';
  return 'status-normal';
}

/** Provides the icon name for the toast type. */
function toastIcon(type) {
  return {
    success: 'task_alt',
    error: 'error',
    warning: 'warning',
    info: 'info'
  }[type] || 'notifications';
}

/** Returns a small skeleton grid for the dashboard cards. */
function skeletonMetricMarkup() {
  return Array.from({ length: 6 }).map(() => `
    <div class="glass-card rounded-3xl p-4">
      <div class="skeleton h-4 w-1/2 rounded"></div>
      <div class="skeleton mt-5 h-10 w-20 rounded"></div>
    </div>`).join('');
}

/** Converts a date to yyyy-mm-dd for input[type=date]. */
function toDateInputValue(date) {
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
}

/** Adds days to an input date string and returns yyyy-mm-dd. */
function addDaysToInputValue(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return toDateInputValue(next);
}

/** Downloads text as a file. */
function downloadTextFile(text, fileName, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 400);
}

/** Charts base options with a medical dashboard feel. */
function chartOptions(type) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: type === 'line' ? 'top' : 'bottom', labels: { usePointStyle: true } }
    },
    scales: type === 'pie' ? {} : {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(148,163,184,0.12)' } }
    }
  };
}

/** Provides a manual retry path for the user's core workflows. */
async function withRetry(fn, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Debounces high-frequency event handlers. */
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
