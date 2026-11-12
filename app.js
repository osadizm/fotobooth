(() => {
  const $ = id => document.getElementById(id);
  const { FRAMES, render, hit } = PB;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- ค่าที่จำไว้ในเครื่อง ---------- */
  const DEF = { title: 'วันแสนสนุก', showDate: true, timer: 3, mirror: true, sound: true, camId: '', facing: 'user', idle: 0, frame: 'classic' };
  let S = DEF;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('photobooth') || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem('photobooth', JSON.stringify(S)); } catch (e) {} };

  let frame = FRAMES.find(f => f.id === S.frame) || FRAMES[0];
  let photos = [];          // รูปดิบของแต่ละช่อง (canvas) — ครอปตอนวาดลงกรอบ จึงเปลี่ยนกรอบได้
  let filter = 'none';
  let stream = null, shooting = false, cancelShoot = false, queue = [];

  const thaiDate = () => new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const opts = () => ({ title: S.title, date: S.showDate ? thaiDate() : '' });

  let toastT = 0;
  function toast(t, ms = 3200) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), ms); }

  /* ---------- สลับหน้าจอ ---------- */
  function go(name) {
    document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== name);
    document.body.dataset.screen = name;
    if (name === 'frames') buildGrid();
    if (name === 'result') showResult();
    if (name === 'home') { stopCamera(); photos = []; filter = 'none'; }
    window.scrollTo(0, 0);
    bumpIdle();
  }
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));

  /* ---------- รูปตัวอย่างกรอบ ---------- */
  const big = document.createElement('canvas'), bctx = big.getContext('2d');
  function thumb(f, width) {
    big.width = f.W; big.height = f.H; render(bctx, f, null, opts());
    const c = document.createElement('canvas'), h = Math.round(width * f.H / f.W);
    c.width = width; c.height = h; c.getContext('2d').drawImage(big, 0, 0, width, h);
    return c;
  }
  function buildFan() {
    const fan = $('fan'); fan.innerHTML = '';
    ['polaroid', 'birthday', 'kawaii'].map(id => FRAMES.find(f => f.id === id)).forEach(f => fan.appendChild(thumb(f, 360)));
  }
  $('frameCount').textContent = FRAMES.length;

  const CATS = [['all', 'ทั้งหมด'], ['strip', 'แถบยาว'], ['single', 'รูปเดียว'], ['multi', 'หลายรูป'], ['land', 'แนวนอน']];
  let cat = 'all', thumbCache = {};
  CATS.forEach(([k, label]) => {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = label; b.dataset.k = k;
    b.setAttribute('aria-pressed', k === cat);
    b.onclick = () => { cat = k; document.querySelectorAll('#cats .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); buildGrid(); };
    $('cats').appendChild(b);
  });
  function buildGrid() {
    $('keepNote').hidden = !photos.some(Boolean);
    const g = $('frameGrid'); g.innerHTML = '';
    FRAMES.filter(f => cat === 'all' || f.cat === cat).forEach(f => {
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
  function refreshThumbs() { thumbCache = {}; buildFan(); if (document.body.dataset.screen === 'frames') buildGrid(); }
  function pickFrame(f) {
    frame = f; S.frame = f.id; save();
    if (photos.some(Boolean)) go('result');
    else startShoot(f.slots.map((_, i) => i));
  }
  $('startBtn').onclick = () => { ac(); go('frames'); };
  $('framesBack').onclick = () => go(photos.some(Boolean) ? 'result' : 'home');

  /* ---------- กล้อง ---------- */
  const video = $('video');
  async function startCamera() {
    if (stream && stream.active) return true;
    const msg = $('camMsg'); msg.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camError('เบราว์เซอร์นี้ใช้กล้องไม่ได้ หรือหน้านี้ไม่ได้เปิดผ่าน https'); return false; }
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const tries = [];
    if (S.camId) tries.push(Object.assign({ deviceId: { exact: S.camId } }, base));
    tries.push(Object.assign({ facingMode: S.facing }, base), true);
    let err;
    for (const v of tries) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); break; } catch (e) { err = e; }
    }
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
    tr.onended = () => { stream = null; if (document.body.dataset.screen === 'shoot') camError('กล้องหลุดการเชื่อมต่อ'); };
    listCams(st.deviceId);
    return true;
  }
  function camError(t) {
    const m = $('camMsg'); m.hidden = false;
    m.innerHTML = '<div><b>😢</b>เปิดกล้องไม่ได้<small></small><button class="btn primary">ลองอีกครั้ง</button></div>';
    m.querySelector('small').textContent = t;
    m.querySelector('button').onclick = async () => { if (await startCamera()) { m.hidden = true; fitVP(); } };
  }
  function stopCamera() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
  async function listCams(cur) {
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      $('flipBtn').hidden = cams.length < 2;
      const sel = $('sCam'); sel.innerHTML = '<option value="">กล้องอัตโนมัติ</option>';
      cams.forEach((d, i) => sel.add(new Option(d.label || 'กล้อง ' + (i + 1), d.deviceId, false, d.deviceId === S.camId)));
    } catch (e) {}
  }
  $('flipBtn').onclick = async () => {
    S.facing = S.facing === 'user' ? 'environment' : 'user'; S.camId = ''; save();
    stopCamera(); await startCamera(); fitVP();
  };

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
  addEventListener('resize', () => { if (document.body.dataset.screen === 'shoot') fitVP(); });
  function setSlot(i) {
    curSlot = i; fitVP();
    const n = frame.slots.length, full = queue.length === n;
    $('prog').textContent = n === 1 ? 'ยิ้มกว้าง ๆ 😁' : full || shooting ? 'รูปที่ ' + (i + 1) + ' จาก ' + n : 'ถ่ายช่องที่ ' + (i + 1) + ' ใหม่';
    drawThumbs();
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
  const miniCache = new WeakMap();
  function mini(c) {
    if (!miniCache.has(c)) { const m = document.createElement('canvas'); m.width = 120; m.height = Math.round(120 * c.height / c.width); m.getContext('2d').drawImage(c, 0, 0, m.width, m.height); miniCache.set(c, m.toDataURL('image/jpeg', .7)); }
    return miniCache.get(c);
  }
  async function startShoot(list) {
    queue = list; go('shoot');
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
      photos[i] = capture(); $('count').textContent = '';
      $('freeze').src = photos[i].toDataURL('image/jpeg', .8); $('freeze').classList.add('on');
      drawThumbs(); await wait(1100); $('freeze').classList.remove('on');
      if (cancelShoot) return endShots(false);
      await wait(250);
    }
    endShots(true);
  }
  function endShots(done) {
    shooting = false; $('shoot').classList.remove('busy'); $('count').textContent = ''; $('freeze').classList.remove('on');
    if (done) { tone(988, .12); setTimeout(() => tone(1319, .2), 120); go('result'); }
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
  $('shootBack').onclick = () => { cancelShoot = true; go(photos.some(Boolean) ? 'result' : 'frames'); };
  document.addEventListener('keydown', e => {
    if (document.body.dataset.screen !== 'shoot' || $('settings').open) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); runShots(); }
    if (e.key === 'Escape' && !shooting) $('shootBack').click();
  });

  /* ---------- ฟิลเตอร์ (คำนวณเองทีละพิกเซล ใช้ได้ทุกเบราว์เซอร์) ---------- */
  const FILTERS = {
    none: ['ปกติ', null],
    bw: ['ขาวดำ', (r, g, b) => { const l = (.299 * r + .587 * g + .114 * b - 128) * 1.12 + 128; return [l, l, l]; }],
    sepia: ['ซีเปีย', (r, g, b) => [.393 * r + .769 * g + .189 * b, .349 * r + .686 * g + .168 * b, .272 * r + .534 * g + .131 * b]],
    warm: ['อบอุ่น', (r, g, b) => [r * 1.08 + 10, g * 1.02 + 4, b * .88]],
    cool: ['เย็นตา', (r, g, b) => [r * .9, g * 1.01 + 3, b * 1.1 + 12]],
    vivid: ['สดใส', (r, g, b) => { const l = .299 * r + .587 * g + .114 * b, s = 1.4; return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s].map(v => (v - 128) * 1.08 + 128); }],
    vintage: ['วินเทจ', (r, g, b) => { const sr = .393 * r + .769 * g + .189 * b, sg = .349 * r + .686 * g + .168 * b, sb = .272 * r + .534 * g + .131 * b; return [(r * .6 + sr * .4) * .82 + 36, (g * .6 + sg * .4) * .82 + 30, (b * .6 + sb * .4) * .8 + 26]; }]
  };
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
    b.onclick = () => { filter = k; showResult(); };
    $('filters').appendChild(b);
  });

  /* ---------- ผลลัพธ์ ---------- */
  const out = $('out'), octx = out.getContext('2d');
  function showResult() {
    out.width = frame.W; out.height = frame.H;
    render(octx, frame, frame.slots.map((_, i) => photos[i] ? filtered(photos[i]) : null), opts());
    document.querySelectorAll('#filters .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === filter));
    const miss = frame.slots.map((_, i) => i).filter(i => !photos[i]);
    $('missing').hidden = !miss.length;
    $('missingTxt').textContent = 'กรอบนี้ใช้ ' + frame.slots.length + ' รูป ยังขาดอีก ' + miss.length + ' รูป';
    $('shootMissing').onclick = () => startShoot(miss);
    $('saveBtn').disabled = $('printBtn').disabled = $('shareBtn').disabled = miss.length > 0;
  }
  out.addEventListener('click', e => {
    const r = out.getBoundingClientRect(), i = hit(frame, (e.clientX - r.left) * frame.W / r.width, (e.clientY - r.top) * frame.H / r.height);
    if (i >= 0) startShoot([i]);
  });
  const stamp = () => new Date().toLocaleString('sv').replace(/[-: ]/g, '').slice(0, 14);
  const toBlob = () => new Promise(r => out.toBlob(r, 'image/jpeg', .93));
  $('saveBtn').onclick = async () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(await toBlob()); a.download = 'photobooth-' + stamp() + '.jpg';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('บันทึกรูปแล้ว ✓');
  };
  if (navigator.canShare) {
    try { if (navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] })) $('shareBtn').hidden = false; } catch (e) {}
  }
  $('shareBtn').onclick = async () => {
    try { await navigator.share({ files: [new File([await toBlob()], 'photobooth-' + stamp() + '.jpg', { type: 'image/jpeg' })], title: S.title }); }
    catch (e) { if (e.name !== 'AbortError') toast('แชร์ไม่สำเร็จ ลองกดบันทึกรูปแทน'); }
  };
  // ปริ้นลงกระดาษ 4x6 นิ้ว (แถบยาวจะได้ 2 แถบ ตัดครึ่ง)
  $('printBtn').onclick = async () => {
    const land = frame.W > frame.H, strip = frame.H / frame.W >= 2.5, url = out.toDataURL('image/jpeg', .95);
    $('pageSize').textContent = '@page{size:' + (land ? '6in 4in' : '4in 6in') + ';margin:0}';
    const box = $('printBox'); box.innerHTML = '';
    for (let i = 0; i < (strip ? 2 : 1); i++) { const im = new Image(); im.src = url; box.appendChild(im); }
    await Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    window.print();
  };
  $('changeFrame').onclick = () => go('frames');
  $('retakeAll').onclick = () => { photos = []; startShoot(frame.slots.map((_, i) => i)); };
  $('doneBtn').onclick = () => { go('home'); toast('พร้อมสำหรับคนต่อไปแล้ว 🎉'); };

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
  $('setBtn').onclick = () => {
    $('sTitle').value = S.title; $('sDate').checked = S.showDate; $('sMirror').checked = S.mirror; $('sSound').checked = S.sound; $('sIdle').value = S.idle;
    $('sCam').value = S.camId;
    dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  };
  let titleT = 0;
  $('sTitle').oninput = () => { S.title = $('sTitle').value; save(); clearTimeout(titleT); titleT = setTimeout(() => { refreshThumbs(); if (document.body.dataset.screen === 'result') showResult(); }, 250); };
  $('sDate').onchange = () => { S.showDate = $('sDate').checked; save(); refreshThumbs(); if (document.body.dataset.screen === 'result') showResult(); };
  $('sMirror').onchange = () => { S.mirror = $('sMirror').checked; save(); };
  $('sSound').onchange = () => { S.sound = $('sSound').checked; save(); };
  $('sIdle').onchange = () => { S.idle = +$('sIdle').value; save(); bumpIdle(); };
  $('sCam').onchange = async () => { S.camId = $('sCam').value; save(); if (stream) { stopCamera(); await startCamera(); fitVP(); } };

  /* ---------- เต็มจอ ---------- */
  $('fsBtn').onclick = async () => {
    const d = document, e = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else await (e.requestFullscreen || e.webkitRequestFullscreen).call(e);
    } catch (x) { toast('อุปกรณ์นี้เปิดเต็มจอจากปุ่มไม่ได้ ลองเพิ่มเว็บไว้ที่หน้าจอโฮมแล้วเปิดจากไอคอน', 5000); }
  };

  /* ---------- โหมดตู้: ไม่มีคนใช้นาน ๆ ให้กลับหน้าแรก ---------- */
  let idleT = 0;
  function bumpIdle() {
    clearTimeout(idleT);
    if (!S.idle || document.body.dataset.screen === 'home') return;
    idleT = setTimeout(() => { if (shooting) return bumpIdle(); if (dlg.open) dlg.close(); go('home'); }, S.idle * 1000);
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

  /* ---------- เริ่มต้น ---------- */
  buildFan();
  if (document.fonts) {
    Promise.all(["700 40px 'Mali'", "400 40px 'Chonburi'", "700 40px 'Charm'", "400 40px 'Sriracha'", "600 40px 'Prompt'", "italic 800 40px 'Prompt'"].map(f => document.fonts.load(f, 'กขabc')))
      .then(refreshThumbs).catch(() => {});
  }
})();
