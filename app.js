(() => {
  const $ = id => document.getElementById(id);
  const { FRAMES, render, hit } = PB;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const body = document.body;

  /* ---------- ค่าที่จำไว้ในเครื่อง ---------- */
  const DEF = {
    title: 'วันแสนสนุก', showDate: true, timer: 3, mirror: true, sound: true, camId: '', facing: 'user', frame: 'classic',
    allowed: [], filter: 'none', edit: false, printMode: 'guest', cloud: '', preset: '', pin: '', idle: 90, eventMode: false
  };
  let S = DEF;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('photobooth') || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem('photobooth', JSON.stringify(S)); } catch (e) {} };

  let frame = FRAMES.find(f => f.id === S.frame) || FRAMES[0];
  let photos = [];        // ภาพดิบของแต่ละช่อง ครอปตอนวาดลงกรอบ จึงเปลี่ยนกรอบได้
  let filter = S.filter;
  let stream = null, shooting = false, cancelShoot = false, queue = [], afterShoot = 'result';
  let ver = 0;            // เพิ่มทุกครั้งที่รูปเปลี่ยน — ใช้ตัดสินว่าต้องอัปโหลด/ปริ้นใหม่ไหม
  let fin = null;         // ผลลัพธ์ล่าสุดที่ส่งให้แขก { ver, url, rec, printed, frame }
  let lastPrint = null;   // { url, frame } สำหรับปริ้นซ้ำ

  const thaiDate = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const opts = () => ({ title: S.title, date: S.showDate ? thaiDate() : '' });
  const hasCloud = () => !!(S.cloud && S.preset);
  const screen = () => body.dataset.screen;

  let toastT = 0;
  function toast(t, ms = 3200) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), ms); }

  /* ---------- สลับหน้าจอ ---------- */
  function go(name) {
    document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== name);
    body.dataset.screen = name;
    if (name === 'frames') buildGrid();
    if (name === 'result') showResult();
    if (name === 'done') showDone();
    if (name === 'home') { stopCamera(); photos = []; filter = S.filter; fin = null; ver++; applyHome(); }
    window.scrollTo(0, 0);
    bumpIdle();
  }
  $('brandBtn').onclick = () => { if (!S.eventMode) go('home'); };

  /* ---------- กรอบที่ผู้จัดงานเปิดให้ใช้ ---------- */
  function allowedFrames() {
    const a = FRAMES.filter(f => !S.allowed.length || S.allowed.includes(f.id));
    return a.length ? a : FRAMES;
  }
  function ensureFrame() { const a = allowedFrames(); if (!a.includes(frame)) frame = a[0]; }
  const guestEdits = () => !S.eventMode || S.edit;

  /* ---------- หน้าแรก ---------- */
  const big = document.createElement('canvas'), bctx = big.getContext('2d');
  function thumb(f, width) {
    big.width = f.W; big.height = f.H; render(bctx, f, null, opts());
    const c = document.createElement('canvas'), h = Math.round(width * f.H / f.W);
    c.width = width; c.height = h; c.getContext('2d').drawImage(big, 0, 0, width, h);
    return c;
  }
  function applyHome() {
    body.classList.toggle('event', S.eventMode);
    $('evTitle').textContent = S.title;
    const a = allowedFrames(), fan = $('fan');
    fan.innerHTML = '';
    const show = S.eventMode ? a.slice(0, 3) : ['polaroid', 'birthday', 'kawaii'].map(id => FRAMES.find(f => f.id === id));
    show.forEach(f => fan.appendChild(thumb(f, 360)));
    fan.dataset.n = show.length;
    const pr = S.printMode !== 'off', qr = hasCloud();
    if (S.eventMode) {
      $('lead').textContent = ['ถ่ายรูปฟรี!', qr && 'สแกน QR โหลดรูปเข้ามือถือ', pr && 'รับรูปปริ้นเป็นที่ระลึก'].filter(Boolean).join(' · ');
      const steps = [a.length > 1 && 'เลือกกรอบ', 'ยิ้มให้กล้อง', qr ? 'สแกน QR' : null, pr ? 'รับรูปปริ้น' : null].filter(Boolean);
      if (steps.length < 2) steps.push('รับรูป');
      $('hero').querySelector('.steps').innerHTML = steps.map((t, i) => '<li><b>' + (i + 1) + '</b>' + t + '</li>').join('');
      $('startBtn').textContent = 'แตะเพื่อเริ่มถ่าย 📸';
    } else {
      $('lead').textContent = FRAMES.length + ' กรอบให้เลือก · ถ่ายเสร็จเปลี่ยนกรอบได้ · สแกน QR หรือปริ้นรูปได้ทันที';
      $('hero').querySelector('.steps').innerHTML = '<li><b>1</b>เลือกกรอบ</li><li><b>2</b>ยิ้มให้กล้อง</li><li><b>3</b>รับรูปกลับบ้าน</li>';
      $('startBtn').textContent = 'เริ่มเลย 📸';
    }
  }
  function start() {
    ac(); if (S.eventMode) { fullscreen(true); wake(true); }
    ensureFrame();
    const a = allowedFrames();
    if (a.length === 1) pickFrame(a[0]); else go('frames');
  }
  $('startBtn').onclick = e => { e.stopPropagation(); start(); };
  $('hero').onclick = () => { if (S.eventMode) start(); };

  /* ---------- เลือกกรอบ ---------- */
  const CATS = [['all', 'ทั้งหมด'], ['strip', 'แถบยาว'], ['single', 'รูปเดียว'], ['multi', 'หลายรูป'], ['land', 'แนวนอน']];
  let cat = 'all', thumbCache = {};
  function buildCats() {
    const a = allowedFrames(), el = $('cats'); el.innerHTML = '';
    const cats = CATS.filter(([k]) => k === 'all' || a.some(f => f.cat === k));
    el.hidden = a.length < 6 || cats.length < 3;
    if (!cats.some(([k]) => k === cat)) cat = 'all';
    cats.forEach(([k, label]) => {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = label;
      b.setAttribute('aria-pressed', k === cat);
      b.onclick = () => { cat = k; buildGrid(); };
      el.appendChild(b);
    });
  }
  function buildGrid() {
    buildCats();
    $('keepNote').hidden = !photos.some(Boolean);
    const g = $('frameGrid'); g.innerHTML = '';
    allowedFrames().filter(f => cat === 'all' || f.cat === cat).forEach(f => {
      const b = document.createElement('button'); b.className = 'fcard' + (f === frame ? ' on' : '');
      const th = document.createElement('div'); th.className = 'th';
      th.appendChild(thumbCache[f.id] || (thumbCache[f.id] = thumb(f, 260)));
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = f.name;
      const ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = f.slots.length + ' รูป';
      b.append(th, nm, ct);
      b.onclick = () => pickFrame(f);
      g.appendChild(b);
    });
  }
  function refreshThumbs() { thumbCache = {}; applyHome(); if (screen() === 'frames') buildGrid(); if ($('settings').open) buildPick(); }
  function pickFrame(f) {
    if (frame !== f) ver++;
    frame = f; S.frame = f.id; save();
    if (photos.some(Boolean)) go('result');
    else startShoot(f.slots.map((_, i) => i), guestEdits() ? 'result' : 'done');
  }
  $('framesBack').onclick = () => go(photos.some(Boolean) ? 'result' : 'home');

  /* ---------- กล้อง ---------- */
  const video = $('video');
  async function startCamera() {
    if (stream && stream.active) return true;
    $('camMsg').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camError('เบราว์เซอร์นี้ใช้กล้องไม่ได้ หรือหน้านี้ไม่ได้เปิดผ่าน https'); return false; }
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 } }, tries = [];
    if (S.camId) tries.push(Object.assign({ deviceId: { exact: S.camId } }, base));
    tries.push(Object.assign({ facingMode: S.facing }, base), true);
    let err;
    for (const v of tries) { try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); break; } catch (e) { err = e; } }
    if (!stream) {
      camError(err && err.name === 'NotAllowedError' ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง กดรูปกล้อง/แม่กุญแจที่แถบที่อยู่เว็บ แล้วเลือก "อนุญาต"'
        : err && err.name === 'NotReadableError' ? 'กล้องถูกโปรแกรมอื่นใช้อยู่ ลองปิดโปรแกรมนั้นก่อน'
        : 'ไม่พบกล้อง ลองเสียบกล้องใหม่ แล้วกดลองอีกครั้ง');
      return false;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    const tr = stream.getVideoTracks()[0], st = tr.getSettings();
    video.classList.toggle('mirror', st.facingMode !== 'environment');
    tr.onended = () => { stream = null; if (screen() === 'shoot') camError('กล้องหลุดการเชื่อมต่อ'); };
    listCams();
    return true;
  }
  function camError(t) {
    const m = $('camMsg'); m.hidden = false;
    m.innerHTML = '<div><b>😢</b>เปิดกล้องไม่ได้<small></small><button class="btn primary">ลองอีกครั้ง</button></div>';
    m.querySelector('small').textContent = t;
    m.querySelector('button').onclick = async () => { if (await startCamera()) { m.hidden = true; fitVP(); } };
  }
  function stopCamera() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
  async function listCams() {
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      $('flipBtn').hidden = cams.length < 2 || S.eventMode;
      const sel = $('sCam'); sel.innerHTML = '<option value="">กล้องอัตโนมัติ</option>';
      cams.forEach((d, i) => sel.add(new Option(d.label || 'กล้อง ' + (i + 1), d.deviceId, false, d.deviceId === S.camId)));
    } catch (e) {}
  }
  $('flipBtn').onclick = async () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; S.camId = ''; save(); stopCamera(); await startCamera(); fitVP(); };

  /* ---------- ถ่ายรูป ---------- */
  const vp = $('vp');
  let curSlot = 0;
  function fitVP() {
    const s = frame.slots[curSlot], box = $('stage').getBoundingClientRect(), a = s.w / s.h;
    let w = box.width, h = w / a;
    if (h > box.height - 24) { h = box.height - 24; w = h * a; }
    vp.style.width = Math.max(120, w) + 'px'; vp.style.height = Math.max(90, h) + 'px';
    vp.dataset.shape = s.shape || 'rect';
  }
  addEventListener('resize', () => { if (screen() === 'shoot') fitVP(); });
  function setSlot(i) {
    curSlot = i; fitVP();
    const n = frame.slots.length, full = queue.length === n;
    $('prog').textContent = n === 1 ? 'ยิ้มกว้าง ๆ 😁' : full ? 'รูปที่ ' + (i + 1) + ' จาก ' + n : 'ถ่ายช่องที่ ' + (i + 1) + ' ใหม่';
    drawThumbs();
  }
  const miniCache = new WeakMap();
  function mini(c) {
    if (!miniCache.has(c)) { const m = document.createElement('canvas'); m.width = 120; m.height = Math.round(120 * c.height / c.width); m.getContext('2d').drawImage(c, 0, 0, m.width, m.height); miniCache.set(c, m.toDataURL('image/jpeg', .7)); }
    return miniCache.get(c);
  }
  function drawThumbs() {
    const t = $('thumbs'); t.innerHTML = '';
    if (frame.slots.length < 2) return;
    frame.slots.forEach((s, i) => {
      const el = document.createElement('i'); el.textContent = i + 1;
      if (photos[i]) { el.classList.add('has'); el.style.backgroundImage = 'url(' + mini(photos[i]) + ')'; }
      if (i === curSlot) el.classList.add('cur');
      t.appendChild(el);
    });
  }
  async function startShoot(list, then) {
    queue = list; afterShoot = then || (guestEdits() ? 'result' : 'done');
    go('shoot');
    $('shoot').classList.remove('busy'); $('count').textContent = '';
    setSlot(queue[0]);
    await startCamera(); fitVP();
  }
  function renderTimer() {
    const t = $('timerSel'); t.innerHTML = '';
    [3, 5, 10].forEach(n => {
      const b = document.createElement('button'); b.textContent = n + ' วิ'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', S.timer === n);
      b.onclick = () => { S.timer = n; save(); renderTimer(); };
      t.appendChild(b);
    });
  }
  renderTimer();
  function bigText(t, word) { const c = $('count'); c.textContent = t; c.className = word ? 'word' : ''; void c.offsetWidth; c.classList.add('pop'); }
  async function runShots() {
    if (shooting) return;
    if (!stream && !(await startCamera())) return;
    ac(); shooting = true; cancelShoot = false; $('shoot').classList.add('busy');
    for (const i of queue.slice()) {
      setSlot(i);
      for (let s = S.timer; s > 0; s--) {
        bigText(s); tone(s === 1 ? 880 : 600, .15);
        await wait(1000); if (cancelShoot) return endShots(false);
      }
      bigText('ยิ้ม! 😁', true); await wait(280);
      const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); shutter();
      photos[i] = capture(); ver++; $('count').textContent = '';
      $('freeze').src = photos[i].toDataURL('image/jpeg', .8); $('freeze').classList.add('on');
      drawThumbs(); await wait(1100); $('freeze').classList.remove('on');
      if (cancelShoot) return endShots(false);
      await wait(250);
    }
    endShots(true);
  }
  function endShots(done) {
    shooting = false; $('shoot').classList.remove('busy'); $('count').textContent = ''; $('freeze').classList.remove('on');
    if (done) { tone(988, .12); setTimeout(() => tone(1319, .2), 120); go(afterShoot); }
    bumpIdle();
  }
  // เก็บภาพเต็มเฟรมของกล้อง แล้วค่อยครอปตามช่องตอนวาด
  function capture() {
    const w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 1920 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d');
    if (video.classList.contains('mirror') && S.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0, c.width, c.height);
    return c;
  }
  $('shutter').onclick = runShots;
  $('shootBack').onclick = () => {
    cancelShoot = true;
    if (photos.some(Boolean) && frame.slots.every((_, i) => photos[i])) go(afterShoot === 'done' ? 'done' : 'result');
    else if (photos.some(Boolean) && guestEdits()) go('result');
    else go(allowedFrames().length > 1 ? 'frames' : 'home');
  };

  /* ---------- ฟิลเตอร์ (คำนวณทีละพิกเซล ใช้ได้ทุกเบราว์เซอร์) ---------- */
  const FILTERS = {
    none: ['ปกติ', null],
    bw: ['ขาวดำ', (r, g, b) => { const l = (.299 * r + .587 * g + .114 * b - 128) * 1.12 + 128; return [l, l, l]; }],
    sepia: ['ซีเปีย', (r, g, b) => [.393 * r + .769 * g + .189 * b, .349 * r + .686 * g + .168 * b, .272 * r + .534 * g + .131 * b]],
    warm: ['อบอุ่น', (r, g, b) => [r * 1.08 + 10, g * 1.02 + 4, b * .88]],
    cool: ['เย็นตา', (r, g, b) => [r * .9, g * 1.01 + 3, b * 1.1 + 12]],
    vivid: ['สดใส', (r, g, b) => { const l = .299 * r + .587 * g + .114 * b, s = 1.4; return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s].map(v => (v - 128) * 1.08 + 128); }],
    vintage: ['วินเทจ', (r, g, b) => { const sr = .393 * r + .769 * g + .189 * b, sg = .349 * r + .686 * g + .168 * b, sb = .272 * r + .534 * g + .131 * b; return [(r * .6 + sr * .4) * .82 + 36, (g * .6 + sg * .4) * .82 + 30, (b * .6 + sb * .4) * .8 + 26]; }]
  };
  if (!FILTERS[filter]) filter = 'none';
  const fCache = new WeakMap();
  function filtered(c) {
    const fn = FILTERS[filter][1]; if (!fn) return c;
    let m = fCache.get(c); if (!m) fCache.set(c, m = {});
    if (m[filter]) return m[filter];
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, o.width, o.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const v = fn(p[i], p[i + 1], p[i + 2]); p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2]; }
    x.putImageData(d, 0, 0);
    return m[filter] = o;
  }
  Object.entries(FILTERS).forEach(([k, [label]]) => {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = label; b.dataset.k = k;
    b.onclick = () => { filter = k; ver++; showResult(); };
    $('filters').appendChild(b);
    $('sFilter').add(new Option(label, k));
  });

  /* ---------- หน้าแก้รูป ---------- */
  const out = $('out'), octx = out.getContext('2d');
  function renderOut() {
    out.width = frame.W; out.height = frame.H;
    render(octx, frame, frame.slots.map((_, i) => photos[i] ? filtered(photos[i]) : null), opts());
  }
  function showResult() {
    renderOut();
    document.querySelectorAll('#filters .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === filter));
    const miss = frame.slots.map((_, i) => i).filter(i => !photos[i]);
    $('missing').hidden = !miss.length;
    $('missingTxt').textContent = 'กรอบนี้ใช้ ' + frame.slots.length + ' รูป ยังขาดอีก ' + miss.length + ' รูป';
    $('shootMissing').onclick = () => startShoot(miss, 'result');
    $('getBtn').disabled = miss.length > 0;
    $('changeFrame').hidden = allowedFrames().length < 2;
  }
  out.addEventListener('click', e => {
    const r = out.getBoundingClientRect(), i = hit(frame, (e.clientX - r.left) * frame.W / r.width, (e.clientY - r.top) * frame.H / r.height);
    if (i >= 0) startShoot([i], 'result');
  });
  $('getBtn').onclick = () => go('done');
  $('changeFrame').onclick = () => go('frames');
  $('retakeAll').onclick = () => { photos = []; ver++; startShoot(frame.slots.map((_, i) => i), 'result'); };
  $('cancelBtn').onclick = () => go('home');

  /* ---------- หน้ารับรูป: QR + ปริ้น ---------- */
  const stamp = () => new Date().toLocaleString('sv').replace(/[-: ]/g, '').slice(0, 14);
  const outBlob = () => new Promise(r => out.toBlob(r, 'image/jpeg', .92));
  async function showDone() {
    const ev = S.eventMode, pm = S.printMode;
    $('saveBtn').hidden = ev; $('shareBtn').hidden = ev || !canShareFiles;
    $('backEdit').hidden = !guestEdits();
    $('retakeDone').hidden = guestEdits();
    $('printBtn').hidden = ev ? pm !== 'guest' : false;
    $('qrArea').hidden = !hasCloud(); $('noQrHead').hidden = hasCloud();
    $('printMsg').textContent = '';
    if (fin && fin.ver === ver) { reflectPrint(); return; }      // ไม่มีอะไรเปลี่ยน ใช้ของเดิม
    renderOut();
    const url = out.toDataURL('image/jpeg', .92);
    $('finalImg').src = url;
    const blob = await outBlob();
    fin = { ver, url, blob, frame, printed: false, rec: { t: Date.now(), blob, url: '' } };
    lastPrint = { url, frame };
    try { fin.rec.id = await dbAdd(fin.rec); } catch (e) {}
    bumpCount();
    reflectPrint();
    if (pm === 'auto') doPrint();
    if (hasCloud()) sendQR(fin);
  }
  function reflectPrint() {
    const b = $('printBtn');
    b.disabled = S.eventMode && fin && fin.printed;
    b.textContent = S.eventMode && fin && fin.printed ? '🖨 ส่งปริ้นแล้ว' : '🖨 ปริ้นรูป';
    $('retakeDone').hidden = guestEdits() || (fin && fin.printed);
    if (fin && fin.printed) $('printMsg').textContent = 'กำลังปริ้น รับรูปได้ที่เครื่องปริ้นเลย 🎁';
  }
  async function sendQR(f) {
    const box = $('qrBox'), msg = $('qrMsg'), retry = $('qrRetry');
    retry.hidden = true; box.innerHTML = '<div class="spin"></div>'; msg.textContent = 'กำลังเตรียม QR...';
    try {
      const view = await upload(f.blob);
      f.rec.url = view; if (f.rec.id != null) dbPut(f.rec).catch(() => {});
      if (fin !== f) return;
      const c = qrCanvas(view);
      box.innerHTML = '';
      if (c) { box.appendChild(c); msg.textContent = 'เปิดกล้องมือถือแล้วสแกนได้เลย'; }
      else { msg.textContent = 'สร้าง QR ไม่ได้ (โหลดตัวสร้าง QR ไม่สำเร็จ)'; }
    } catch (e) {
      if (fin !== f) return;
      box.innerHTML = '<div class="qr-fail">📶</div>';
      msg.textContent = 'ส่งรูปขึ้นเน็ตไม่สำเร็จ ลองอีกครั้งได้ (รูปถูกเก็บไว้ในเครื่องแล้ว)';
      retry.hidden = false; retry.onclick = () => sendQR(f);
    }
  }
  $('printBtn').onclick = () => {
    if (S.eventMode && fin && fin.printed) return;
    if (S.printMode === 'off' && S.eventMode) return;
    doPrint();
  };
  $('saveBtn').onclick = async () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(fin ? fin.blob : await outBlob()); a.download = 'photobooth-' + stamp() + '.jpg';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('บันทึกรูปแล้ว ✓');
  };
  let canShareFiles = false;
  try { canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] })); } catch (e) {}
  $('shareBtn').onclick = async () => {
    try { await navigator.share({ files: [new File([fin.blob], 'photobooth-' + stamp() + '.jpg', { type: 'image/jpeg' })], title: S.title }); }
    catch (e) { if (e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ ลองกดบันทึกรูปแทน'); }
  };
  $('finishBtn').onclick = () => { go('home'); toast('ขอบคุณที่มาถ่ายรูปนะ 💖'); };
  $('backEdit').onclick = () => go('result');
  $('retakeDone').onclick = () => { photos = []; ver++; startShoot(frame.slots.map((_, i) => i), 'done'); };

  /* ---------- ปริ้น (กระดาษ 4x6 นิ้ว, กรอบแถบยาวได้ 2 แถบ) ---------- */
  async function doPrint(p) {
    p = p || (fin && { url: fin.url, frame: fin.frame }) || lastPrint;
    if (!p) { toast('ยังไม่มีรูปให้ปริ้น'); return; }
    const f = p.frame, land = f.W > f.H, strip = f.H / f.W >= 2.5;
    $('pageSize').textContent = '@page{size:' + (land ? '6in 4in' : '4in 6in') + ';margin:0}';
    const box = $('printBox'); box.innerHTML = '';
    for (let i = 0; i < (strip ? 2 : 1); i++) { const im = new Image(); im.src = p.url; box.appendChild(im); }
    await Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    if (fin && p.url === fin.url) { fin.printed = true; reflectPrint(); }
    window.print();
  }

  /* ---------- อัปโหลด Cloudinary + QR ---------- */
  async function upload(blob) {
    if (!hasCloud()) throw new Error('nocfg');
    let err;
    for (let n = 0; n < 3; n++) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
      try {
        const fd = new FormData(); fd.append('file', blob, 'photo.jpg'); fd.append('upload_preset', S.preset); fd.append('tags', 'photobooth');
        const r = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(S.cloud) + '/image/upload', { method: 'POST', body: fd, signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) { err = new Error((j.error && j.error.message) || 'upload failed'); if (r.status >= 400 && r.status < 500) break; continue; }
        return new URL('v.html?c=' + encodeURIComponent(S.cloud) + '&p=' + encodeURIComponent(j.public_id) + '&f=' + encodeURIComponent(j.format || 'jpg'), location.href).href;
      } catch (e) { err = e; await wait(1500); } finally { clearTimeout(t); }
    }
    throw err;
  }
  function qrCanvas(text) {
    if (typeof qrcode !== 'function') return null;
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 3, s = Math.max(4, Math.floor(300 / (n + m * 2))), c = document.createElement('canvas');
    c.width = c.height = (n + m * 2) * s;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + m) * s, (r + m) * s, s, s);
    return c;
  }

  /* ---------- นับจำนวนชุดต่อวัน ---------- */
  const today = () => new Date().toLocaleDateString('sv');
  function countToday() { try { const c = JSON.parse(localStorage.getItem('pbCount') || '{}'); return c.d === today() ? c.n : 0; } catch (e) { return 0; } }
  function bumpCount() { try { localStorage.setItem('pbCount', JSON.stringify({ d: today(), n: countToday() + 1 })); } catch (e) {} }

  /* ---------- คลังรูปในเครื่อง (IndexedDB) + zip ---------- */
  const DB = new Promise((res, rej) => {
    try { const r = indexedDB.open('photobooth', 1); r.onupgradeneeded = () => r.result.createObjectStore('s', { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    catch (e) { rej(e); }
  });
  DB.catch(() => {});
  async function tx(mode, fn) {
    const db = await DB;
    return new Promise((res, rej) => { const t = db.transaction('s', mode); let v; const r = fn(t.objectStore('s')); if (r) r.onsuccess = () => v = r.result; t.oncomplete = () => res(v); t.onerror = () => rej(t.error); });
  }
  const dbAdd = r => tx('readwrite', s => s.add(r)), dbPut = r => tx('readwrite', s => s.put(r)), dbAll = () => tx('readonly', s => s.getAll()), dbClr = () => tx('readwrite', s => s.clear());
  const fname = r => 'photobooth-' + new Date(r.t).toLocaleString('sv').replace(/[-: ]/g, '') + '-' + r.id + '.jpg';
  function dlBlob(b, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  let galUrls = [];
  async function openGallery() {
    const dlg = $('gallery'); if (!dlg.open) dlg.showModal();
    let a = [];
    try { a = await dbAll() || []; } catch (e) { $('galInfo').textContent = 'เบราว์เซอร์นี้เก็บรูปในเครื่องไม่ได้'; return; }
    const pend = a.filter(r => !r.url).length;
    $('galInfo').textContent = 'เก็บไว้ ' + a.length + ' ชุด · วันนี้ถ่ายไป ' + countToday() + ' ชุด' + (pend ? ' · ยังไม่ได้อัปโหลด ' + pend + ' ชุด' : '');
    $('galUp').hidden = !pend || !hasCloud(); $('galZip').disabled = !a.length;
    galUrls.forEach(u => URL.revokeObjectURL(u)); galUrls = [];
    const g = $('galGrid'); g.innerHTML = '';
    a.slice(-40).reverse().forEach(r => {
      const im = new Image(), u = URL.createObjectURL(r.blob); galUrls.push(u);
      im.src = u; im.alt = ''; im.title = new Date(r.t).toLocaleTimeString('th-TH'); if (!r.url) im.className = 'pend';
      im.onclick = () => dlBlob(r.blob, fname(r)); g.appendChild(im);
    });
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = -1; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  async function zip(files) {   // แบบไม่บีบอัด (JPEG บีบไม่ลงอยู่แล้ว)
    const parts = [], cen = [], enc = new TextEncoder(); let off = 0;
    for (const f of files) {
      const d = new Uint8Array(await f.blob.arrayBuffer()), nm = enc.encode(f.name), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
      h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
      parts.push(h, nm, d);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
      c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cen.push(c, nm); off += 30 + nm.length + d.length;
    }
    const cs = cen.reduce((s, x) => s + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, e], { type: 'application/zip' });
  }
  $('galZip').onclick = async () => {
    const b = $('galZip'); b.disabled = true; b.textContent = 'กำลังรวมไฟล์...';
    try { const a = await dbAll(); dlBlob(await zip(a.map(r => ({ name: fname(r), blob: r.blob }))), 'photobooth-' + today() + '.zip'); }
    catch (e) { toast('รวมไฟล์ไม่สำเร็จ'); }
    b.disabled = false; b.textContent = '⬇ ดาวน์โหลดทั้งหมด (.zip)';
  };
  $('galUp').onclick = async () => {
    const b = $('galUp'); b.disabled = true; let ok = 0, bad = 0;
    for (const r of (await dbAll()).filter(r => !r.url)) {
      b.textContent = 'กำลังอัปโหลด... (' + (ok + bad + 1) + ')';
      try { r.url = await upload(r.blob); await dbPut(r); ok++; } catch (e) { bad++; }
    }
    b.disabled = false; b.textContent = '☁ อัปโหลดรูปที่ค้าง';
    toast('อัปโหลดสำเร็จ ' + ok + ' ชุด' + (bad ? ' · ไม่สำเร็จ ' + bad + ' ชุด' : '')); openGallery();
  };
  let clrArm = 0;
  $('galClr').onclick = async () => {
    const b = $('galClr');
    if (!clrArm) { clrArm = setTimeout(() => { clrArm = 0; b.textContent = 'ลบทั้งหมด'; }, 3000); b.textContent = 'แตะอีกครั้งเพื่อยืนยันการลบ'; return; }
    clearTimeout(clrArm); clrArm = 0; b.textContent = 'ลบทั้งหมด';
    try { await dbClr(); } catch (e) {}
    openGallery();
  };
  $('galClose').onclick = () => $('gallery').close();
  $('openGallery').onclick = openGallery;

  /* ---------- เสียง ---------- */
  let AC = null;
  function ac() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} return AC; }
  function tone(f, d) {
    if (!S.sound || !ac()) return;
    const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f;
    g.gain.setValueAtTime(.22, AC.currentTime); g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + d);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + d);
  }
  function shutter() {
    if (!S.sound || !ac()) return;
    const n = AC.sampleRate * .12, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = AC.createBufferSource(), g = AC.createGain(); g.gain.value = .45; s.buffer = b; s.connect(g).connect(AC.destination); s.start();
  }

  /* ---------- ตั้งค่า ---------- */
  const dlg = $('settings');
  const PRESETS = [
    ['ทั้งหมด', []],
    ['💍 งานแต่ง', ['wedding', 'polaroid', 'trio', 'classic', 'film', 'magazine', 'postcard', 'grid']],
    ['🎂 วันเกิด', ['birthday', 'grid', 'kawaii', 'comic', 'neon', 'polaroid', 'classic', 'magazine']],
    ['🎊 ปาร์ตี้/บริษัท', ['neon', 'comic', 'retro', 'film', 'classic', 'magazine', 'grid', 'trio']],
    ['🎓 รับปริญญา', ['grad', 'polaroid', 'classic', 'magazine', 'grid', 'trio']],
    ['🎄 คริสต์มาส', ['xmas', 'polaroid', 'classic', 'grid', 'kawaii']]
  ];
  PRESETS.forEach(([label, ids]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label;
    b.onclick = () => { S.allowed = ids.slice(); save(); ensureFrame(); buildPick(); applyHome(); };
    $('presetBtns').appendChild(b);
  });
  let pickCache = {};
  function buildPick() {
    const g = $('pickGrid'); g.innerHTML = '';
    FRAMES.forEach(f => {
      const l = document.createElement('label'); l.className = 'pick';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !S.allowed.length || S.allowed.includes(f.id);
      const th = document.createElement('span'); th.className = 'pth';
      th.appendChild(pickCache[f.id] || (pickCache[f.id] = thumb(f, 110)));
      const nm = document.createElement('span'); nm.textContent = f.name;
      l.append(cb, th, nm);
      cb.onchange = () => {
        const on = [...g.querySelectorAll('input')].map((c, i) => c.checked ? FRAMES[i].id : null).filter(Boolean);
        if (!on.length) { cb.checked = true; toast('ต้องเลือกอย่างน้อย 1 กรอบ'); return; }
        S.allowed = on.length === FRAMES.length ? [] : on; save(); ensureFrame(); applyHome();
      };
      g.appendChild(l);
    });
  }
  function openSettings() {
    $('sTitle').value = S.title; $('sDate').checked = S.showDate; $('sFilter').value = S.filter; $('sEdit').checked = S.edit;
    $('sPrint').value = S.printMode; $('sCloud').value = S.cloud; $('sPreset').value = S.preset;
    $('sCam').value = S.camId; $('sMirror').checked = S.mirror; $('sSound').checked = S.sound;
    $('sPin').value = S.pin; $('sIdle').value = S.idle; $('testUpMsg').textContent = '';
    $('startEvent').textContent = S.eventMode ? '✓ อยู่ในโหมดงานแล้ว' : '▶ เริ่มโหมดงาน';
    $('startEvent').disabled = S.eventMode;
    pickCache = {}; buildPick();
    dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  }
  $('setBtn').onclick = openSettings;
  let titleT = 0;
  $('sTitle').oninput = () => { S.title = $('sTitle').value; save(); ver++; clearTimeout(titleT); titleT = setTimeout(() => { pickCache = {}; refreshThumbs(); if (screen() === 'result') showResult(); }, 300); };
  $('sDate').onchange = () => { S.showDate = $('sDate').checked; save(); ver++; pickCache = {}; refreshThumbs(); };
  $('sFilter').onchange = () => { S.filter = filter = $('sFilter').value; save(); ver++; };
  $('sEdit').onchange = () => { S.edit = $('sEdit').checked; save(); };
  $('sPrint').onchange = () => { S.printMode = $('sPrint').value; save(); applyHome(); };
  $('sCloud').oninput = () => { S.cloud = $('sCloud').value.trim(); save(); applyHome(); };
  $('sPreset').oninput = () => { S.preset = $('sPreset').value.trim(); save(); applyHome(); };
  $('sMirror').onchange = () => { S.mirror = $('sMirror').checked; save(); };
  $('sSound').onchange = () => { S.sound = $('sSound').checked; save(); };
  $('sPin').oninput = () => { S.pin = $('sPin').value.trim(); save(); };
  $('sIdle').onchange = () => { S.idle = +$('sIdle').value; save(); };
  $('sCam').onchange = async () => { S.camId = $('sCam').value; save(); if (stream) { stopCamera(); await startCamera(); fitVP(); } };
  $('testUp').onclick = async () => {
    const m = $('testUpMsg');
    if (!hasCloud()) { m.textContent = 'กรอก Cloud name และ Upload preset ก่อน'; return; }
    m.textContent = 'กำลังทดสอบ...';
    const c = thumb(frame, 300), b = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
    try { await upload(b); m.textContent = '✓ ใช้งานได้ แขกจะได้ QR หลังถ่ายเสร็จ'; }
    catch (e) { m.textContent = '✗ ไม่สำเร็จ: ' + (e.message === 'nocfg' ? 'ยังตั้งค่าไม่ครบ' : e.message) + ' — เช็กชื่อ และตั้ง preset เป็น Unsigned'; }
  };
  $('testPrint').onclick = () => { const c = document.createElement('canvas'); c.width = frame.W; c.height = frame.H; render(c.getContext('2d'), frame, null, opts()); doPrint({ url: c.toDataURL('image/jpeg', .9), frame }); };
  $('startEvent').onclick = () => {
    if (S.pin === '' && !confirmNoPin) { confirmNoPin = true; toast('ยังไม่ได้ตั้ง PIN แขกจะออกจากโหมดงานได้ ถ้าไม่เป็นไร กดเริ่มอีกครั้ง', 5000); return; }
    dlg.close(); setEvent(true);
  };
  let confirmNoPin = false;

  /* ---------- โหมดงาน ---------- */
  let wl = null;
  async function wake(on) { try { if (on && !wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); } else if (!on && wl) { await wl.release(); wl = null; } } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (S.eventMode && document.visibilityState === 'visible') wake(true); });
  async function fullscreen(on, loud) {
    const d = document, e = d.documentElement;
    try {
      const isFs = d.fullscreenElement || d.webkitFullscreenElement;
      if (on && !isFs) await (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
      else if (!on && isFs) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } catch (x) { if (loud) toast('อุปกรณ์นี้เปิดเต็มจอจากปุ่มไม่ได้ ลองเพิ่มเว็บไว้ที่หน้าจอโฮมแล้วเปิดจากไอคอน', 5000); }
  }
  $('fsBtn').onclick = () => fullscreen(!(document.fullscreenElement || document.webkitFullscreenElement), true);
  function setEvent(on) {
    S.eventMode = on; save();
    if (on) { fullscreen(true); wake(true); } else { wake(false); fullscreen(false); }
    go('home');
    toast(on ? 'เริ่มโหมดงานแล้ว · เจ้าหน้าที่แตะมุมซ้ายบน 5 ครั้งเพื่อเปิดเมนู' : 'ออกจากโหมดงานแล้ว', 5000);
  }

  // จุดลับมุมซ้ายบน: แตะ 5 ครั้ง หรือกดค้าง 2 วิ (ไม่สน pointercancel/leave ที่จอสัมผัสส่งมาเองตอนกดค้าง)
  const hot = $('hot'); let taps = 0, tapT = 0, holdT = 0;
  hot.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    taps++; clearTimeout(tapT); tapT = setTimeout(() => taps = 0, 2500);
    if (taps >= 5) { taps = 0; clearTimeout(holdT); hot.classList.remove('hold'); openStaff(); return; }
    clearTimeout(holdT); hot.classList.remove('hold'); void hot.offsetWidth; hot.classList.add('hold');
    holdT = setTimeout(() => { hot.classList.remove('hold'); openStaff(); }, 2000);
  });
  hot.addEventListener('pointerup', () => { clearTimeout(holdT); hot.classList.remove('hold'); });
  hot.addEventListener('contextmenu', e => e.preventDefault());
  hot.addEventListener('click', e => e.stopPropagation());
  const staff = $('staff');
  function openStaff() {
    if (staff.open) return;
    if (shooting) cancelShoot = true;
    $('staffCount').textContent = 'วันนี้ถ่ายไป ' + countToday() + ' ชุด';
    $('pinWrap').hidden = !S.pin; $('pinIn').value = '';
    $('stReprint').disabled = !lastPrint;
    staff.showModal();
    if (S.pin) setTimeout(() => $('pinIn').focus(), 50);
  }
  function pinOk() { if (!S.pin || $('pinIn').value === S.pin) return true; $('pinIn').value = ''; toast('PIN ไม่ถูกต้อง'); return false; }
  $('stExit').onclick = () => { if (pinOk()) { staff.close(); setEvent(false); } };
  $('stSettings').onclick = () => { if (pinOk()) { staff.close(); openSettings(); } };
  $('stGallery').onclick = () => { if (pinOk()) { staff.close(); openGallery(); } };
  $('stReprint').onclick = () => { if (pinOk()) { staff.close(); doPrint(lastPrint); } };
  $('stClose').onclick = () => staff.close();
  $('pinIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('stExit').click(); } });

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && S.eventMode) { e.preventDefault(); openStaff(); return; }
    if (screen() === 'shoot') {
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); runShots(); }
      if (e.key === 'Escape' && !shooting) $('shootBack').click();
    } else if (screen() === 'home' && S.eventMode && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); start(); }
  });

  /* ---------- ไม่มีคนใช้นาน ๆ กลับหน้าแรก (เฉพาะโหมดงาน) ---------- */
  let deadline = 0;
  function bumpIdle() { deadline = Date.now() + S.idle * 1000; }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));
  setInterval(() => {
    const left = Math.ceil((deadline - Date.now()) / 1000), sc = screen();
    $('doneTimer').textContent = S.eventMode && sc === 'done' && left <= 15 && left > 0 ? 'กลับหน้าแรกใน ' + left + ' วินาที' : '';
    if (!S.eventMode || sc === 'home' || shooting || document.querySelector('dialog[open]')) return;
    if (left <= 0) go('home');
  }, 1000);

  /* ---------- เริ่มต้น ---------- */
  ensureFrame(); applyHome(); bumpIdle();
  if (S.eventMode) setTimeout(() => toast('โหมดงาน · แตะหน้าจอเพื่อเริ่ม', 2500), 300);
  if (document.fonts) {
    Promise.all(["700 40px 'Mali'", "400 40px 'Chonburi'", "700 40px 'Charm'", "400 40px 'Sriracha'", "600 40px 'Prompt'", "italic 800 40px 'Prompt'"].map(f => document.fonts.load(f, 'กขabc')))
      .then(refreshThumbs).catch(() => {});
  }
})();
