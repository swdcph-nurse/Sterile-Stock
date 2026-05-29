(() => {
  const LIBRARY_URLS = [
    'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.0/umd/index.min.js',
    'https://unpkg.com/@zxing/browser@0.2.0'
  ];

  const FORMAT_NAMES = ['CODE_128', 'CODE_39', 'EAN_13', 'QR_CODE'];
  const DEFAULT_STATUS = 'กำลังเตรียมกล้องหลังเพื่อสแกน...';

  const state = {
    overlay: null,
    video: null,
    status: null,
    errorPanel: null,
    errorText: null,
    flashBtn: null,
    switchBtn: null,
    retryBtn: null,
    helpBtn: null,
    manualInput: null,
    manualBtn: null,
    reader: null,
    controls: null,
    stream: null,
    active: false,
    facingMode: 'environment',
    torchEnabled: false,
    lastScanValue: '',
    lastScanAt: 0,
    onDetected: null,
    onClose: null,
    onStatus: null
  };

  const api = {
    open,
    close,
    destroy: close,
    isOpen: () => Boolean(state.overlay)
  };

  window.SterileBarcodeScanner = api;

  window.addEventListener('pagehide', () => close());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      close();
    }
  });

  async function open(options = {}) {
    close();
    state.onDetected = typeof options.onDetected === 'function' ? options.onDetected : null;
    state.onClose = typeof options.onClose === 'function' ? options.onClose : null;
    state.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
    state.facingMode = options.initialFacingMode === 'user' ? 'user' : 'environment';
    state.lastScanValue = '';
    state.lastScanAt = 0;

    state.overlay = await createOverlay();
    document.body.appendChild(state.overlay);
    bindOverlayEvents();

    try {
      await ensureScannerLibrary();
      await startCamera();
    } catch (error) {
      showPermissionError(error);
    }
  }

  function close() {
    stopCamera();
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    state.video = null;
    state.status = null;
    state.errorPanel = null;
    state.errorText = null;
    state.flashBtn = null;
    state.switchBtn = null;
    state.retryBtn = null;
    state.helpBtn = null;
    state.manualInput = null;
    state.manualBtn = null;
    state.onDetected = null;
    state.onStatus = null;
    if (typeof state.onClose === 'function') {
      state.onClose();
    }
    state.onClose = null;
  }

  async function createOverlay() {
    const template = await loadTemplateHtml();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = template.trim();
    return wrapper.firstElementChild;
  }

  async function loadTemplateHtml() {
    try {
      const response = await fetch('./scanner-modal.html', { cache: 'no-store' });
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      console.warn('scanner modal template fetch failed', error);
    }
    return defaultTemplateHtml();
  }

  function defaultTemplateHtml() {
    return `
      <div class="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="scannerTitle">
        <div class="scanner-shell">
          <div class="scanner-header">
            <div>
              <div id="scannerTitle" class="scanner-title">สแกนบาร์โค้ด</div>
              <div class="scanner-subtitle">กล้องหลัง • โฟกัสต่อเนื่อง • รองรับมือถือและแท็บเล็ต</div>
            </div>
            <button type="button" class="scanner-close" data-scanner-action="close" aria-label="ปิดสแกน">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
          <div class="scanner-content">
            <div class="scanner-camera-card">
              <video id="scannerVideo" class="scanner-video" autoplay muted playsinline></video>
              <div class="scanner-overlay-frame"></div>
              <div class="scanner-scan-line"></div>
            </div>
            <div class="scanner-status-card">
              <div class="scanner-status-row">
                <div id="scannerStatus" class="scanner-status scanner-status-pulse">${DEFAULT_STATUS}</div>
                <div class="scanner-actions">
                  <button type="button" id="scannerFlashBtn" class="scanner-action-btn scanner-action-btn--primary" hidden>
                    <span class="material-symbols-rounded text-base">flash_on</span> แฟลช
                  </button>
                  <button type="button" id="scannerSwitchBtn" class="scanner-action-btn">
                    <span class="material-symbols-rounded text-base">cameraswitch</span> สลับกล้อง
                  </button>
                </div>
              </div>
              <div class="scanner-hint">
                แตะให้บาร์โค้ดอยู่ในกรอบกลางจอ ระบบจะสแกนทุก 300ms และกันยิงซ้ำ 1.5 วินาที
              </div>
            </div>
            <div id="scannerErrorPanel" class="scanner-error hidden">
              <div class="scanner-error-title">ไม่สามารถเปิดกล้องได้</div>
              <div id="scannerErrorText" class="scanner-error-text">กรุณาอนุญาตสิทธิ์กล้องในเบราว์เซอร์ แล้วกด Retry เพื่อเริ่มสแกนใหม่</div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" id="scannerRetryBtn" class="scanner-action-btn scanner-action-btn--primary">
                  <span class="material-symbols-rounded text-base">refresh</span> Retry
                </button>
                <button type="button" id="scannerPermissionHelpBtn" class="scanner-action-btn">
                  <span class="material-symbols-rounded text-base">help</span> วิธีเปิดสิทธิ์
                </button>
              </div>
            </div>
            <div class="scanner-manual">
              <label class="scanner-manual-label" for="scannerManualInput">กรอกรหัสด้วยตนเอง</label>
              <div class="scanner-manual-row">
                <input id="scannerManualInput" class="scanner-manual-input" type="search" placeholder="พิมพ์หรือยิงด้วยเครื่องสแกนแบบคีย์บอร์ด" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="search" enterkeyhint="search">
                <button type="button" id="scannerManualBtn" class="scanner-manual-submit">ค้นหา</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function bindOverlayEvents() {
    state.video = state.overlay.querySelector('#scannerVideo');
    state.status = state.overlay.querySelector('#scannerStatus');
    state.errorPanel = state.overlay.querySelector('#scannerErrorPanel');
    state.errorText = state.overlay.querySelector('#scannerErrorText');
    state.flashBtn = state.overlay.querySelector('#scannerFlashBtn');
    state.switchBtn = state.overlay.querySelector('#scannerSwitchBtn');
    state.retryBtn = state.overlay.querySelector('#scannerRetryBtn');
    state.helpBtn = state.overlay.querySelector('#scannerPermissionHelpBtn');
    state.manualInput = state.overlay.querySelector('#scannerManualInput');
    state.manualBtn = state.overlay.querySelector('#scannerManualBtn');

    state.overlay.querySelectorAll('[data-scanner-action="close"]').forEach((button) => {
      button.addEventListener('click', () => close());
    });
    state.switchBtn?.addEventListener('click', () => switchCamera());
    state.flashBtn?.addEventListener('click', () => toggleFlash());
    state.retryBtn?.addEventListener('click', () => restartCamera());
    state.helpBtn?.addEventListener('click', () => showPermissionHelp());
    state.manualBtn?.addEventListener('click', () => submitManualCode());
    state.manualInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitManualCode();
      }
    });
    state.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
  }

  async function ensureScannerLibrary() {
    if (window.ZXingBrowser?.BrowserMultiFormatReader) {
      return window.ZXingBrowser;
    }

    for (const src of LIBRARY_URLS) {
      try {
        await loadScriptOnce(src);
        if (window.ZXingBrowser?.BrowserMultiFormatReader) {
          return window.ZXingBrowser;
        }
      } catch (error) {
        console.warn('load scanner library failed', src, error);
      }
    }

    throw new Error('ไม่สามารถโหลดไลบรารีสแกนบาร์โค้ดได้');
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.querySelectorAll('script[data-scanner-src]'))
        .find((script) => script.dataset.scannerSrc === src);
      if (existing && existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      if (existing && existing.dataset.loading === 'true') {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = existing || document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.scannerSrc = src;
      script.dataset.loading = 'true';
      script.onload = () => {
        script.dataset.loaded = 'true';
        script.dataset.loading = 'false';
        resolve();
      };
      script.onerror = () => {
        script.dataset.loading = 'false';
        reject(new Error(`โหลดไลบรารีไม่สำเร็จ: ${src}`));
      };

      if (!existing) {
        document.head.appendChild(script);
      }
    });
  }

  function buildHints() {
    const zxing = window.ZXingBrowser;
    const decodeHintType = zxing?.DecodeHintType || window.ZXing?.DecodeHintType || null;
    const barcodeFormat = zxing?.BarcodeFormat || window.ZXing?.BarcodeFormat || null;
    const hints = new Map();

    if (decodeHintType && barcodeFormat) {
      if (decodeHintType.TRY_HARDER) {
        hints.set(decodeHintType.TRY_HARDER, true);
      }
      if (decodeHintType.POSSIBLE_FORMATS) {
        const formats = FORMAT_NAMES
          .map((name) => barcodeFormat[name])
          .filter(Boolean);
        if (formats.length) {
          hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
        }
      }
    }

    return hints;
  }

  function buildConstraints() {
    const preset = choosePreset();
    return {
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate, max: preset.frameRate }
      }
    };
  }

  function choosePreset() {
    const memory = Number(navigator.deviceMemory || 4);
    const cores = Number(navigator.hardwareConcurrency || 4);
    const shortestSide = Math.min(window.screen?.width || 1280, window.screen?.height || 720);

    if (memory <= 2 || cores <= 4 || shortestSide <= 720) {
      return { width: 640, height: 480, frameRate: 12 };
    }
    if (memory <= 4 || cores <= 6) {
      return { width: 1280, height: 720, frameRate: 15 };
    }
    return { width: 1920, height: 1080, frameRate: 18 };
  }

  async function startCamera() {
    state.active = true;
    state.status.textContent = DEFAULT_STATUS;
    state.status.classList.add('scanner-status-pulse');
    state.errorPanel.classList.add('hidden');
    state.overlay.classList.remove('scanner-error-mode');

    const zxing = window.ZXingBrowser;
    const hints = buildHints();
    state.reader = new zxing.BrowserMultiFormatReader(hints, 300);
    try {
      state.controls = await state.reader.decodeFromConstraints(
        buildConstraints(),
        state.video,
        async (result, error, controls) => {
          if (error && error.name && error.name !== 'NotFoundException') {
            console.warn('scanner decode error', error);
          }
          if (result && typeof result.getText === 'function') {
            await handleDetection(result.getText());
          }
          if (controls) {
            state.controls = controls;
          }
        }
      );

      await waitForVideoReady();
      await tuneCameraTrack();
      state.status.textContent = 'พร้อมสแกน';
      state.status.classList.remove('scanner-status-pulse');
      updateTorchButton();
      state.manualInput?.focus({ preventScroll: true });
      emitStatus();
    } catch (error) {
      stopCamera();
      showPermissionError(error);
      throw error;
    }
  }

  async function restartCamera() {
    stopCamera();
    try {
      await ensureScannerLibrary();
      await startCamera();
    } catch (error) {
      showPermissionError(error);
    }
  }

  function stopCamera() {
    state.active = false;
    try {
      state.controls?.stop?.();
    } catch (error) {
      console.warn('scanner controls stop failed', error);
    }
    try {
      state.reader?.reset?.();
    } catch (error) {
      console.warn('scanner reader reset failed', error);
    }
    if (state.stream) {
      state.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('stop track failed', error);
        }
      });
    }
    state.stream = null;
    state.reader = null;
    state.controls = null;
    state.torchEnabled = false;
  }

  async function waitForVideoReady() {
    const video = state.video;
    if (!video) {
      return;
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    await new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('canplay', done);
        resolve();
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('canplay', done, { once: true });
    });
  }

  async function tuneCameraTrack() {
    const video = state.video;
    const track = video?.srcObject?.getVideoTracks?.()[0];
    if (!track) {
      return;
    }

    state.stream = video.srcObject;
    const capabilities = track.getCapabilities?.() || {};
    const advanced = [];

    if (capabilities.focusMode && Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (capabilities.exposureMode && Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (capabilities.whiteBalanceMode && Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }

    if (capabilities.zoom) {
      const minZoom = Number(capabilities.zoom.min || 1);
      const maxZoom = Number(capabilities.zoom.max || 1);
      const targetZoom = Math.max(minZoom, Math.min(maxZoom, 2));
      if (targetZoom > minZoom) {
        advanced.push({ zoom: targetZoom });
      }
    }

    if (advanced.length) {
      try {
        await track.applyConstraints({ advanced });
      } catch (error) {
        console.warn('apply advanced camera constraints failed', error);
      }
    }
  }

  function updateTorchButton() {
    const track = state.video?.srcObject?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (capabilities.torch) {
      state.flashBtn.hidden = false;
      state.flashBtn.disabled = false;
      state.flashBtn.innerHTML = `<span class="material-symbols-rounded text-base">${state.torchEnabled ? 'flash_off' : 'flash_on'}</span> ${state.torchEnabled ? 'ปิดแฟลช' : 'แฟลช'}`;
    } else {
      state.flashBtn.hidden = true;
    }
  }

  async function toggleFlash() {
    const track = state.video?.srcObject?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (!capabilities.torch) {
      state.status.textContent = 'อุปกรณ์นี้ไม่รองรับแฟลช';
      return;
    }

    state.torchEnabled = !state.torchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: state.torchEnabled }] });
      updateTorchButton();
    } catch (error) {
      console.warn('toggle flash failed', error);
      state.torchEnabled = false;
      updateTorchButton();
    }
  }

  async function switchCamera() {
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    state.status.textContent = state.facingMode === 'environment' ? 'สลับเป็นกล้องหลัง' : 'สลับเป็นกล้องหน้า';
    await restartCamera();
  }

  async function submitManualCode() {
    const value = String(state.manualInput?.value || '').trim();
    if (!value) {
      state.status.textContent = 'กรุณากรอกรหัสก่อน';
      return;
    }
    await handleDetection(value, { manual: true });
  }

  async function handleDetection(code, meta = {}) {
    const value = String(code || '').trim();
    if (!value) {
      return;
    }

    const now = Date.now();
    if (state.lastScanValue === value && now - state.lastScanAt < 1500) {
      return;
    }
    state.lastScanValue = value;
    state.lastScanAt = now;

    state.status.textContent = `พบรหัส: ${value}`;
    state.status.classList.add('scanner-status-ok');
    vibrateSuccess();
    beepSuccess();

    if (typeof state.onDetected === 'function') {
      await state.onDetected(value, meta);
    }

    setTimeout(() => close(), 180);
  }

  function vibrateSuccess() {
    try {
      navigator.vibrate?.(60);
    } catch (error) {
      console.warn('vibrate failed', error);
    }
  }

  function beepSuccess() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 920;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.22);
      setTimeout(() => ctx.close?.(), 400);
    } catch (error) {
      console.warn('beep failed', error);
    }
  }

  function showPermissionError(error) {
    const message = getReadableError(error);
    state.overlay.classList.add('scanner-error-mode');
    state.errorPanel.classList.remove('hidden');
    state.errorText.textContent = message;
    state.status.textContent = 'ไม่สามารถเปิดกล้องได้';
    state.status.classList.remove('scanner-status-pulse');
    state.manualInput?.focus({ preventScroll: true });
    emitStatus(message);
  }

  function showPermissionHelp() {
    state.errorText.textContent = 'บนมือถือ: เปิดการอนุญาตกล้องในแถบ Address หรือ Settings ของเบราว์เซอร์ แล้วกด Retry อีกครั้ง';
  }

  function getReadableError(error) {
    const message = error && error.message ? String(error.message) : String(error || 'ไม่สามารถเปิดกล้องได้');
    if (/NotAllowedError|Permission/i.test(message)) {
      return 'เบราว์เซอร์ยังไม่อนุญาตให้ใช้กล้อง กรุณาแตะ Allow Camera แล้วกด Retry';
    }
    if (/NotFoundError|OverconstrainedError/i.test(message)) {
      return 'ไม่พบกล้องหลังที่รองรับ ลองสลับกล้องหรือเปิดด้วยเบราว์เซอร์ Chrome/Safari เวอร์ชันล่าสุด';
    }
    if (/NotReadableError|AbortError/i.test(message)) {
      return 'กล้องอาจถูกใช้งานอยู่โดยแอปอื่น กรุณาปิดแอปที่ใช้กล้องแล้วลองใหม่';
    }
    return message;
  }

  function emitStatus(message) {
    if (typeof state.onStatus === 'function') {
      state.onStatus(message || state.status?.textContent || '');
    }
  }
})();
