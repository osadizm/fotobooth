/* ============================================================
   คลังกรอบรูป
   เพิ่มกรอบใหม่ได้โดย push object เข้า FRAMES:
   {
     id, name, cat: 'strip' | 'single' | 'multi' | 'land',
     W, H,                       // ขนาดภาพผลลัพธ์ (px)
     slots: [{ x, y, w, h,       // ช่องรูป
               r,                // มุมโค้ง
               rot,              // หมุน (องศา)
               shape,            // 'rect' | 'circle' | 'arch' | 'poly'
               poly,             // จุดของรูปหลายเหลี่ยม (ใช้กับ shape 'poly')
               card,             // { pad, bottom } การ์ดขาวแบบโพลารอยด์ใต้รูป
               stroke, sw, glow, shadow }],
     bg(ctx, o),                 // วาดพื้นหลัง (ก่อนรูป)
     fg(ctx, o)                  // วาดของตกแต่งทับรูป (ข้อความ ฯลฯ)
   }
   o = { W, H, title, date }
   ============================================================ */
(function () {
  const TAU = Math.PI * 2;

  /* ---------- ตัวช่วยวาด ---------- */
  const rng = seed => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  function rrect(c, x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fill(c, col, o) { c.fillStyle = col; c.fillRect(0, 0, o.W, o.H); }
  function vgrad(c, a, b, o) { const g = c.createLinearGradient(0, 0, 0, o.H); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, o.W, o.H); }
  function star(c, x, y, r, col, n = 5, k = .45, rot = -Math.PI / 2) {
    c.beginPath();
    for (let i = 0; i < 2 * n; i++) { const a = rot + i * Math.PI / n, q = i % 2 ? r * k : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
    c.closePath(); c.fillStyle = col; c.fill();
  }
  function heart(c, x, y, r, col) {
    c.beginPath(); c.moveTo(x, y + r * .9);
    c.bezierCurveTo(x - r * 1.6, y - r * .2, x - r * .6, y - r * 1.2, x, y - r * .4);
    c.bezierCurveTo(x + r * .6, y - r * 1.2, x + r * 1.6, y - r * .2, x, y + r * .9);
    c.fillStyle = col; c.fill();
  }
  function confetti(c, o, cols, n, seed, scale = 1) {
    const R = rng(seed);
    for (let i = 0; i < n; i++) {
      const x = R() * o.W, y = R() * o.H, s = (6 + R() * 12) * scale, col = cols[i % cols.length], q = R();
      c.fillStyle = col;
      if (q < .3) star(c, x, y, s, col);
      else if (q < .6) { c.beginPath(); c.arc(x, y, s / 2, 0, TAU); c.fill(); }
      else { c.save(); c.translate(x, y); c.rotate(R() * 3); c.fillRect(-s / 2, -s / 4, s, s / 2); c.restore(); }
    }
  }
  // ข้อความ: ย่อขนาดอัตโนมัติถ้ายาวเกิน maxW
  function text(c, str, x, y, p = {}) {
    if (!str) return;
    const fam = p.family || "'Prompt'", wt = p.weight || 600;
    let size = p.size || 40;
    const set = () => c.font = `${wt} ${size}px ${fam}, 'Prompt', sans-serif`;
    set();
    if (p.maxW) while (c.measureText(str).width > p.maxW && size > 12) { size -= 2; set(); }
    c.textAlign = p.align || 'center'; c.textBaseline = 'alphabetic';
    c.save();
    if (p.glow) { c.shadowColor = p.glow; c.shadowBlur = p.blur || 24; }
    if (p.offset) { c.fillStyle = p.offset; c.fillText(str, x + (p.od || 6), y + (p.od || 6)); }
    if (p.stroke) { c.lineJoin = 'round'; c.lineWidth = p.sw || 8; c.strokeStyle = p.stroke; c.strokeText(str, x, y); }
    c.fillStyle = p.color || '#222'; c.fillText(str, x, y);
    if (p.glow) c.fillText(str, x, y);
    c.restore();
  }
  // ทำงานในพิกัดของช่องรูปที่หมุนอยู่
  function inSlot(c, s, fn) {
    c.save();
    if (s.rot) { const cx = s.x + s.w / 2, cy = s.y + s.h / 2; c.translate(cx, cy); c.rotate(s.rot * Math.PI / 180); c.translate(-cx, -cy); }
    fn(); c.restore();
  }
  function polySlot(pts, extra) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return Object.assign({ shape: 'poly', poly: pts, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }, extra);
  }
  function burst(c, x, y, r, col, word, rot = -.15) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath();
    for (let i = 0; i < 28; i++) { const a = i * TAU / 28, q = i % 2 ? r * .68 : r; c.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
    c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = 7; c.strokeStyle = '#111'; c.stroke();
    text(c, word, 0, r * .2, { size: r * .5, weight: 'italic 800', color: '#fff', stroke: '#111', sw: 8 });
    c.restore();
  }
  function balloon(c, x, y, col) {
    c.beginPath(); c.moveTo(x, y + 68); c.bezierCurveTo(x - 25, y + 140, x + 25, y + 180, x - 5, y + 260);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; c.stroke();
    c.beginPath(); c.ellipse(x, y, 55, 68, 0, 0, TAU); c.fillStyle = col; c.fill();
    c.beginPath(); c.moveTo(x - 9, y + 76); c.lineTo(x + 9, y + 76); c.lineTo(x, y + 64); c.fill();
    c.beginPath(); c.ellipse(x - 20, y - 26, 10, 18, -.5, 0, TAU); c.fillStyle = 'rgba(255,255,255,.55)'; c.fill();
  }
  function bunting(c, o, y0, sag, cols) {
    const q = t => y0 + sag * 4 * t * (1 - t);
    c.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(t * o.W, q(t)); }
    c.strokeStyle = '#8a5a2b'; c.lineWidth = 3; c.stroke();
    for (let k = 0; k < 8; k++) {
      const t = (k + .5) / 8, x = t * o.W, y = q(t);
      c.beginPath(); c.moveTo(x - 26, y); c.lineTo(x + 26, y); c.lineTo(x, y + 58); c.closePath();
      c.fillStyle = cols[k % cols.length]; c.fill();
    }
  }
  function holly(c, x, y) {
    c.fillStyle = '#2b8a3e';
    [[-22, -6, -.5], [20, -10, .5]].forEach(([dx, dy, a]) => { c.beginPath(); c.ellipse(x + dx, y + dy, 26, 11, a, 0, TAU); c.fill(); });
    [[-4, 4], [8, 6], [2, -6]].forEach(([dx, dy]) => { c.beginPath(); c.arc(x + dx, y + dy, 8, 0, TAU); c.fillStyle = '#ff6b6b'; c.fill(); });
  }
  function ornament(c, cx, y, half, col) {
    c.strokeStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx - half, y); c.lineTo(cx - 30, y); c.moveTo(cx + 30, y); c.lineTo(cx + half, y); c.stroke();
    c.beginPath(); c.moveTo(cx, y - 14); c.lineTo(cx + 14, y); c.lineTo(cx, y + 14); c.lineTo(cx - 14, y); c.closePath(); c.fillStyle = col; c.fill();
  }

  const F = [];

  /* 1. แถบคลาสสิก */
  F.push({
    id: 'classic', name: 'แถบคลาสสิก', cat: 'strip', W: 600, H: 1800,
    slots: [0, 1, 2, 3].map(i => ({ x: 40, y: 40 + i * 410, w: 520, h: 390 })),
    bg: (c, o) => fill(c, '#ffffff', o),
    fg(c, o) {
      text(c, o.title, 300, 1722, { size: 44, color: '#222', maxW: 520 });
      text(c, o.date, 300, 1768, { size: 24, weight: 400, color: '#888' });
    }
  });

  /* 2. ฟิล์ม */
  F.push({
    id: 'film', name: 'ฟิล์มถ่ายรูป', cat: 'strip', W: 600, H: 1800,
    slots: [0, 1, 2, 3].map(i => ({ x: 70, y: 60 + i * 385, w: 460, h: 345 })),
    bg(c, o) {
      fill(c, '#141414', o); c.fillStyle = '#f4eee0';
      for (let y = 20; y < o.H; y += 60) { c.beginPath(); rrect(c, 14, y, 22, 34, 5); rrect(c, o.W - 36, y, 22, 34, 5); c.fill(); }
    },
    fg(c, o) {
      this.slots.forEach((s, i) => {
        text(c, '▸ ' + (i + 1) + 'A', s.x, s.y + s.h + 28, { size: 20, color: '#ffb02e', align: 'left' });
        text(c, 'PHOTO 400', s.x + s.w, s.y + s.h + 28, { size: 20, color: '#ffb02e', align: 'right' });
      });
      text(c, o.title, 300, 1652, { size: 44, color: '#f4eee0', maxW: 460 });
      text(c, o.date, 300, 1705, { size: 24, weight: 400, color: '#9a9a9a' });
    }
  });

  /* 3. โพลารอยด์ */
  F.push({
    id: 'polaroid', name: 'โพลารอยด์', cat: 'single', W: 1200, H: 1440,
    slots: [{ x: 80, y: 80, w: 1040, h: 1040, stroke: 'rgba(0,0,0,.08)', sw: 3 }],
    bg: (c, o) => fill(c, '#fdfcf8', o),
    fg(c, o) {
      text(c, o.title, 600, 1275, { size: 88, family: "'Sriracha'", weight: 400, color: '#333', maxW: 1000 });
      text(c, o.date, 600, 1355, { size: 40, weight: 400, color: '#999' });
    }
  });

  /* 4. โพลารอยด์ 3 ใบบนบอร์ด */
  F.push({
    id: 'trio', name: 'โพลารอยด์ 3 ใบ', cat: 'multi', W: 1200, H: 1800,
    slots: [
      { x: 150, y: 110, w: 640, h: 480, rot: -6, card: { pad: 28, bottom: 110 } },
      { x: 430, y: 640, w: 640, h: 480, rot: 5, card: { pad: 28, bottom: 110 } },
      { x: 140, y: 1170, w: 640, h: 480, rot: -3, card: { pad: 28, bottom: 110 } }
    ],
    bg(c, o) {
      fill(c, '#e3bd8f', o); const R = rng(4);
      for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(110,70,30,${.08 + R() * .2})`; c.beginPath(); c.arc(R() * o.W, R() * o.H, 1 + R() * 3, 0, TAU); c.fill(); }
    },
    fg(c, o) {
      const words = [[o.date, 40], ['♥', 56], [o.title, 58]];
      this.slots.forEach((s, i) => inSlot(c, s, () => {
        const cx = s.x + s.w / 2;
        c.save(); c.translate(cx, s.y - 30); c.rotate(i % 2 ? .06 : -.05);
        c.fillStyle = 'rgba(255,236,150,.8)'; c.fillRect(-75, -22, 150, 44); c.restore();
        text(c, words[i][0], cx, s.y + s.h + 76, { size: words[i][1], family: "'Sriracha'", weight: 400, color: i === 1 ? '#e64980' : '#444', maxW: s.w });
      }));
    }
  });

  /* 5. ตาราง 4 ช่อง พาสเทล */
  F.push({
    id: 'grid', name: 'ตาราง 4 ช่อง', cat: 'multi', W: 1200, H: 1800,
    slots: [0, 1, 2, 3].map(i => ({ x: i % 2 ? 630 : 70, y: i < 2 ? 90 : 755, w: 500, h: 625, r: 36, stroke: '#fff', sw: 14, shadow: 'rgba(214,51,108,.3)' })),
    bg(c, o) {
      fill(c, '#ffe3ec', o); c.fillStyle = 'rgba(255,255,255,.65)';
      for (let y = 0, r = 0; y < o.H + 70; y += 70, r++) for (let x = r % 2 ? 35 : 0; x < o.W + 70; x += 70) { c.beginPath(); c.arc(x, y, 10, 0, TAU); c.fill(); }
    },
    fg(c, o) {
      text(c, o.title, 600, 1530, { size: 88, family: "'Mali'", weight: 700, color: '#d6336c', maxW: 1000 });
      text(c, o.date, 600, 1600, { size: 38, weight: 400, color: '#b0567a' });
      [[110, 1500, 40, '#ff8fab'], [1090, 1560, 50, '#ff4d8d'], [170, 1680, 28, '#ffc2d4'], [1030, 1700, 32, '#ff8fab']].forEach(h => heart(c, ...h));
    }
  });

  /* 6. วันเกิด */
  F.push({
    id: 'birthday', name: 'ปาร์ตี้วันเกิด', cat: 'strip', W: 600, H: 1800,
    slots: [0, 1, 2].map(i => ({ x: 50, y: 170 + i * 400, w: 500, h: 375, r: 18, stroke: '#fff', sw: 10, shadow: 'rgba(0,0,0,.18)' })),
    bg(c, o) {
      fill(c, '#fff3c4', o);
      confetti(c, o, ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8'], 150, 11);
      bunting(c, o, 30, 60, ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8']);
    },
    fg(c, o) {
      text(c, o.title, 300, 1462, { size: 60, family: "'Mali'", weight: 700, color: '#e8590c', maxW: 520, stroke: '#fff', sw: 10 });
      text(c, o.date, 300, 1515, { size: 26, weight: 400, color: '#a0522d' });
      balloon(c, 150, 1610, '#ff6b6b'); balloon(c, 300, 1580, '#4dabf7'); balloon(c, 450, 1615, '#51cf66');
    }
  });

  /* 7. งานแต่ง */
  F.push({
    id: 'wedding', name: 'งานแต่งงาน', cat: 'multi', W: 1200, H: 1800,
    slots: [
      { x: 110, y: 120, w: 980, h: 735, stroke: '#c9a227', sw: 3 },
      { x: 110, y: 890, w: 470, h: 470, stroke: '#c9a227', sw: 3 },
      { x: 620, y: 890, w: 470, h: 470, stroke: '#c9a227', sw: 3 }
    ],
    bg(c, o) {
      fill(c, '#fbf7f0', o); c.strokeStyle = '#c9a227';
      c.lineWidth = 3; c.strokeRect(36, 36, o.W - 72, o.H - 72);
      c.lineWidth = 1; c.strokeRect(52, 52, o.W - 104, o.H - 104);
    },
    fg(c, o) {
      ornament(c, 600, 1440, 260, '#c9a227');
      text(c, o.title, 600, 1570, { size: 104, family: "'Charm'", weight: 700, color: '#8a6d1d', maxW: 1000 });
      text(c, o.date, 600, 1645, { size: 40, weight: 300, color: '#9c8a5a' });
      ornament(c, 600, 1705, 160, '#c9a227');
    }
  });

  /* 8. นีออน */
  const NEON = ['#2ef2ff', '#ff2e93', '#b388ff'];
  F.push({
    id: 'neon', name: 'นีออนปาร์ตี้', cat: 'multi', W: 1200, H: 1800,
    slots: [0, 1, 2].map(i => ({ x: 120, y: 110 + i * 490, w: 960, h: 440, r: 20, stroke: NEON[i], sw: 8, glow: 30 })),
    bg(c, o) {
      fill(c, '#0b0820', o); c.strokeStyle = 'rgba(255,46,147,.13)'; c.lineWidth = 2;
      for (let x = 0; x <= o.W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, o.H); c.stroke(); }
      for (let y = 0; y <= o.H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(o.W, y); c.stroke(); }
    },
    fg(c, o) {
      text(c, o.title, 600, 1668, { size: 100, weight: 'italic 800', color: '#ffe3f1', glow: '#ff2e93', blur: 36, maxW: 1060 });
      text(c, o.date, 600, 1740, { size: 40, weight: 400, color: '#2ef2ff', glow: '#2ef2ff', blur: 16 });
    }
  });

  /* 9. ปกนิตยสาร */
  F.push({
    id: 'magazine', name: 'ปกนิตยสาร', cat: 'single', W: 1200, H: 1600,
    slots: [{ x: 0, y: 0, w: 1200, h: 1600 }],
    bg: (c, o) => fill(c, '#222', o),
    fg(c, o) {
      let g = c.createLinearGradient(0, 0, 0, 460); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, o.W, 460);
      g = c.createLinearGradient(0, 1100, 0, 1600); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.7)'); c.fillStyle = g; c.fillRect(0, 1100, o.W, 500);
      text(c, 'ฉบับพิเศษ  •  ' + (o.date || 'ฉบับนี้'), 600, 72, { size: 30, weight: 600, color: '#fff' });
      text(c, o.title, 600, 250, { size: 190, family: "'Chonburi'", weight: 400, color: '#fff', maxW: 1120, glow: 'rgba(0,0,0,.5)', blur: 20 });
      c.save(); c.translate(1010, 560); c.rotate(-.2);
      c.beginPath(); c.arc(0, 0, 120, 0, TAU); c.fillStyle = '#ffd43b'; c.fill();
      text(c, 'ฉบับ', 0, -10, { size: 44, weight: 800, color: '#111' }); text(c, 'พิเศษ!', 0, 44, { size: 48, weight: 800, color: '#e03131' });
      c.restore();
      text(c, 'เบื้องหลัง', 60, 1190, { size: 44, color: '#fff', align: 'left' });
      text(c, 'รอยยิ้มสุดพิเศษ', 60, 1262, { size: 68, weight: 800, color: '#ffd43b', align: 'left' });
      text(c, 'ประจำวันนี้', 60, 1330, { size: 44, color: '#fff', align: 'left' });
      c.fillStyle = '#fff'; c.fillRect(950, 1430, 190, 110);
      const R = rng(9); c.fillStyle = '#111';
      for (let x = 962; x < 1128;) { const w = 2 + Math.floor(R() * 5); c.fillRect(x, 1442, w, 72); x += w + 2 + Math.floor(R() * 4); }
    }
  });

  /* 10. การ์ตูนคอมิก */
  F.push({
    id: 'comic', name: 'การ์ตูนคอมิก', cat: 'multi', W: 1200, H: 1800,
    slots: [
      polySlot([[50, 50], [1150, 50], [1150, 560], [50, 660]], { stroke: '#111', sw: 10 }),
      polySlot([[50, 700], [1150, 600], [1150, 1130], [50, 1130]], { stroke: '#111', sw: 10 }),
      polySlot([[50, 1170], [1150, 1170], [1150, 1600], [50, 1600]], { stroke: '#111', sw: 10 })
    ],
    bg(c, o) {
      fill(c, '#ffd43b', o); c.fillStyle = 'rgba(0,0,0,.12)';
      for (let y = 0, r = 0; y < o.H + 22; y += 22, r++) for (let x = r % 2 ? 11 : 0; x < o.W + 22; x += 22) { c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); }
    },
    fg(c, o) {
      burst(c, 1030, 170, 130, '#ff3b3b', 'WOW!');
      burst(c, 180, 820, 110, '#4dabf7', 'POW!', .2);
      c.fillStyle = '#fff'; c.fillRect(50, 1630, 1100, 130); c.lineWidth = 8; c.strokeStyle = '#111'; c.strokeRect(50, 1630, 1100, 130);
      text(c, o.title, 600, 1717, { size: 66, family: "'Mali'", weight: 700, color: '#111', maxW: 1040 });
    }
  });

  /* 11. เรโทร 70s */
  F.push({
    id: 'retro', name: 'เรโทร 70s', cat: 'multi', W: 1200, H: 1800,
    slots: [
      { x: 80, y: 110, w: 500, h: 700, shape: 'arch', stroke: '#6b3e26', sw: 10 },
      { x: 620, y: 110, w: 500, h: 700, shape: 'arch', stroke: '#6b3e26', sw: 10 },
      { x: 80, y: 850, w: 1040, h: 620, r: 60, stroke: '#6b3e26', sw: 10 }
    ],
    bg(c, o) {
      fill(c, '#f6e7c8', o);
      c.fillStyle = 'rgba(244,162,89,.35)';
      for (let i = 0; i < 24; i += 2) {
        const a1 = Math.PI + i * Math.PI / 24, a2 = a1 + Math.PI / 24;
        c.beginPath(); c.moveTo(600, 1900); c.lineTo(600 + Math.cos(a1) * 2600, 1900 + Math.sin(a1) * 2600); c.lineTo(600 + Math.cos(a2) * 2600, 1900 + Math.sin(a2) * 2600); c.fill();
      }
    },
    fg(c, o) {
      ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f'].forEach((col, i) => { c.fillStyle = col; c.fillRect(200, 1505 + i * 14, 800, 9); });
      text(c, o.title, 600, 1660, { size: 96, family: "'Chonburi'", weight: 400, color: '#6b3e26', offset: '#e76f51', maxW: 1040 });
      text(c, o.date, 600, 1735, { size: 40, weight: 600, color: '#2a9d8f' });
    }
  });

  /* 12. คริสต์มาส */
  F.push({
    id: 'xmas', name: 'คริสต์มาส', cat: 'strip', W: 600, H: 1800,
    slots: [0, 1, 2, 3].map(i => ({ x: 50, y: 60 + i * 397, w: 500, h: 375, r: 12, stroke: '#fff', sw: 8 })),
    bg(c, o) {
      fill(c, '#b3001b', o); const R = rng(21);
      for (let i = 0; i < 140; i++) { c.fillStyle = `rgba(255,255,255,${.4 + R() * .5})`; c.beginPath(); c.arc(R() * o.W, R() * o.H, 2 + R() * 4, 0, TAU); c.fill(); }
      for (let i = 0; i < 12; i++) star(c, R() * o.W, R() * o.H, 10 + R() * 10, 'rgba(255,255,255,.7)', 6, .3);
    },
    fg(c, o) {
      this.slots.forEach(s => holly(c, s.x + 30, s.y + 22));
      text(c, o.title, 300, 1700, { size: 54, family: "'Mali'", weight: 700, color: '#fff', maxW: 520 });
      text(c, o.date, 300, 1755, { size: 26, weight: 400, color: '#ffd9de' });
    }
  });

  /* 13. รับปริญญา */
  F.push({
    id: 'grad', name: 'รับปริญญา', cat: 'multi', W: 1200, H: 1800,
    slots: [0, 1, 2, 3].map(i => ({ x: i % 2 ? 630 : 70, y: i < 2 ? 80 : 720, w: 500, h: 600, r: 10, stroke: '#fca311', sw: 8 })),
    bg(c, o) { vgrad(c, '#14213d', '#0b132b', o); confetti(c, o, ['#fca311', '#e5e5e5'], 90, 5, .8); },
    fg(c, o) {
      const x = 600, y = 1420, s = 90;
      c.fillStyle = '#d48806'; c.beginPath(); c.moveTo(x - s * .55, y + s * .1); c.lineTo(x + s * .55, y + s * .1); c.lineTo(x + s * .5, y + s * .6); c.quadraticCurveTo(x, y + s * .8, x - s * .5, y + s * .6); c.fill();
      c.fillStyle = '#fca311'; c.beginPath(); c.moveTo(x - s, y); c.lineTo(x, y - s * .45); c.lineTo(x + s, y); c.lineTo(x, y + s * .45); c.fill();
      c.strokeStyle = '#ffe8a3'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + s * .8, y + s * .1); c.lineTo(x + s * .8, y + s * .7); c.stroke();
      c.fillStyle = '#ffe8a3'; c.fillRect(x + s * .8 - 8, y + s * .7, 16, 26);
      text(c, o.title, 600, 1600, { size: 84, weight: 800, color: '#fca311', maxW: 1060 });
      text(c, o.date, 600, 1670, { size: 38, weight: 400, color: '#e5e5e5' });
    }
  });

  /* 14. น่ารักวงกลม */
  F.push({
    id: 'kawaii', name: 'น้องแมวน่ารัก', cat: 'multi', W: 1200, H: 1800,
    slots: [
      { x: 250, y: 110, w: 700, h: 700, shape: 'circle', stroke: '#fff', sw: 16, shadow: 'rgba(255,77,141,.35)' },
      { x: 90, y: 860, w: 480, h: 480, shape: 'circle', stroke: '#fff', sw: 16, shadow: 'rgba(255,77,141,.35)' },
      { x: 630, y: 860, w: 480, h: 480, shape: 'circle', stroke: '#fff', sw: 16, shadow: 'rgba(255,77,141,.35)' }
    ],
    bg(c, o) {
      vgrad(c, '#ffd6e8', '#e5dbff', o); const R = rng(3);
      for (let i = 0; i < 40; i++) star(c, R() * o.W, R() * o.H, 8 + R() * 16, i % 3 ? 'rgba(255,255,255,.8)' : '#ffd43b', 4, .25);
      const ear = (pts, inner) => {
        c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
        c.fillStyle = '#ffb3d1'; c.fill(); c.lineWidth = 16; c.lineJoin = 'round'; c.strokeStyle = '#fff'; c.stroke();
        c.beginPath(); inner.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fillStyle = '#ff8cc6'; c.fill();
      };
      ear([[297, 285], [266, 62], [480, 131]], [[320, 240], [295, 120], [420, 165]]);
      ear([[903, 285], [934, 62], [720, 131]], [[880, 240], [905, 120], [780, 165]]);
    },
    fg(c, o) {
      text(c, o.title, 600, 1500, { size: 96, family: "'Mali'", weight: 700, color: '#ff4d8d', stroke: '#fff', sw: 16, maxW: 1060 });
      text(c, o.date, 600, 1580, { size: 40, weight: 400, color: '#7b5ea7' });
      [[200, 1680, 30, '#ff8fab'], [1000, 1690, 36, '#ff4d8d'], [600, 1700, 22, '#cc5de8']].forEach(h => heart(c, ...h));
    }
  });

  /* 15. โปสการ์ด (แนวนอน) */
  F.push({
    id: 'postcard', name: 'โปสการ์ด', cat: 'land', W: 1800, H: 1200,
    slots: [
      { x: 80, y: 80, w: 1000, h: 750, r: 6, stroke: '#fff', sw: 12, shadow: 'rgba(0,0,0,.2)' },
      { x: 1120, y: 80, w: 600, h: 750, r: 6, stroke: '#fff', sw: 12, shadow: 'rgba(0,0,0,.2)' }
    ],
    bg(c, o) {
      fill(c, '#fdf6e3', o);
      c.save(); c.beginPath(); c.rect(0, 0, o.W, o.H); c.rect(34, 34, o.W - 68, o.H - 68); c.clip('evenodd');
      const cols = ['#d63031', '#fdf6e3', '#0984e3', '#fdf6e3'];
      for (let x = -o.H, i = 0; x < o.W + o.H; x += 30, i++) { c.fillStyle = cols[i % 4]; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 30, 0); c.lineTo(x + 30 - o.H, o.H); c.lineTo(x - o.H, o.H); c.fill(); }
      c.restore();
    },
    fg(c, o) {
      text(c, o.title, 100, 990, { size: 96, family: "'Charm'", weight: 700, color: '#2d3436', align: 'left', maxW: 1200 });
      text(c, o.date, 100, 1070, { size: 38, weight: 400, color: '#636e72', align: 'left' });
      c.strokeStyle = 'rgba(45,52,54,.45)'; c.lineWidth = 4;
      c.beginPath(); c.arc(1400, 1000, 90, 0, TAU); c.stroke();
      for (let k = 0; k < 3; k++) { c.beginPath(); for (let x = 1500; x <= 1720; x += 10) c.lineTo(x, 960 + k * 40 + Math.sin(x / 18) * 8); c.stroke(); }
      const sx = 1500, sy = 880, sw = 220, sh = 250;
      c.fillStyle = '#fff'; c.fillRect(sx, sy, sw, sh); c.fillStyle = '#fdf6e3';
      for (let x = sx; x <= sx + sw; x += 22) { c.beginPath(); c.arc(x, sy, 8, 0, TAU); c.arc(x, sy + sh, 8, 0, TAU); c.fill(); }
      for (let y = sy; y <= sy + sh; y += 22) { c.beginPath(); c.arc(sx, y, 8, 0, TAU); c.arc(sx + sw, y, 8, 0, TAU); c.fill(); }
      c.fillStyle = '#ffeaa7'; c.fillRect(sx + 22, sy + 22, sw - 44, sh - 44);
      heart(c, sx + sw / 2, sy + sh / 2 - 10, 40, '#e17055');
      text(c, 'POST', sx + sw / 2, sy + sh - 40, { size: 30, weight: 800, color: '#2d3436' });
    }
  });

  /* ---------- วาดกรอบ + รูป ---------- */
  function slotPath(c, s) {
    c.beginPath();
    if (s.shape === 'circle') c.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, TAU);
    else if (s.shape === 'poly') { s.poly.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); }
    else if (s.shape === 'arch') { const r = s.w / 2; c.moveTo(s.x, s.y + s.h); c.lineTo(s.x, s.y + r); c.arc(s.x + r, s.y + r, r, Math.PI, 0); c.lineTo(s.x + s.w, s.y + s.h); c.closePath(); }
    else rrect(c, s.x, s.y, s.w, s.h, s.r || 0);
  }
  // วางรูปแบบ "cover" (เต็มช่อง ตัดส่วนเกินตรงกลาง)
  function cover(c, img, x, y, w, h) {
    const iw = img.width, ih = img.height, r = Math.max(w / iw, h / ih), sw = w / r, sh = h / r;
    c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }
  const PH = [['#a5d8ff', '#d0bfff'], ['#ffc9c9', '#ffe066'], ['#b2f2bb', '#99e9f2'], ['#fcc2d7', '#d0bfff']];
  function placeholder(c, s, i) {
    const g = c.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h), p = PH[i % PH.length];
    g.addColorStop(0, p[0]); g.addColorStop(1, p[1]); c.fillStyle = g; c.fillRect(s.x, s.y, s.w, s.h);
    const m = Math.min(s.w, s.h), cx = s.x + s.w / 2, by = s.y + s.h;
    c.fillStyle = 'rgba(255,255,255,.75)';
    c.beginPath(); c.arc(cx, by - m * .58, m * .2, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(cx, by, m * .38, m * .3, 0, Math.PI, 0); c.fill();
  }
  function drawSlot(c, s, img, i) {
    inSlot(c, s, () => {
      if (s.card) {
        const k = s.card; c.save(); c.shadowColor = 'rgba(0,0,0,.28)'; c.shadowBlur = 30; c.shadowOffsetY = 10;
        c.fillStyle = k.color || '#fff'; c.fillRect(s.x - k.pad, s.y - k.pad, s.w + 2 * k.pad, s.h + k.pad + k.bottom); c.restore();
      }
      if (s.shadow) { c.save(); c.shadowColor = s.shadow; c.shadowBlur = 28; c.shadowOffsetY = 8; slotPath(c, s); c.fillStyle = '#fff'; c.fill(); c.restore(); }
      c.save(); slotPath(c, s); c.clip();
      if (img) cover(c, img, s.x, s.y, s.w, s.h); else placeholder(c, s, i);
      c.restore();
      if (s.stroke) {
        c.save(); if (s.glow) { c.shadowColor = s.stroke; c.shadowBlur = s.glow; }
        c.strokeStyle = s.stroke; c.lineWidth = s.sw || 6; c.lineJoin = 'round'; slotPath(c, s); c.stroke(); if (s.glow) c.stroke(); c.restore();
      }
    });
  }
  function render(c, frame, imgs, opts) {
    const o = Object.assign({ W: frame.W, H: frame.H }, opts);
    c.save(); c.clearRect(0, 0, frame.W, frame.H);
    frame.bg(c, o);
    frame.slots.forEach((s, i) => drawSlot(c, s, imgs && imgs[i], i));
    if (frame.fg) frame.fg.call(frame, c, o);
    c.restore();
  }
  // ช่องไหนอยู่ใต้จุด (x,y) — ใช้แตะเพื่อถ่ายช่องนั้นใหม่
  function hit(frame, x, y) {
    for (let i = frame.slots.length - 1; i >= 0; i--) {
      const s = frame.slots[i], cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = -(s.rot || 0) * Math.PI / 180;
      const dx = x - cx, dy = y - cy, px = dx * Math.cos(a) - dy * Math.sin(a), py = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(px) <= s.w / 2 && Math.abs(py) <= s.h / 2) return i;
    }
    return -1;
  }

  window.PB = { FRAMES: F, render, hit };
})();
