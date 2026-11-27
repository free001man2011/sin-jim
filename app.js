(() => {
'use strict';
// normalise the bank: each category gets items [{d,q,a}]
const BANK = (window.QUESTION_BANK || []).map(c => ({
  ...c,
  items: (c.q || []).map(x => Array.isArray(x) ? {d: +x[0], q: x[1], a: x[2]} : {d: +x.d, q: x.q, a: x.a})
    .filter(x => x.d >= 1 && x.d <= 10 && x.q && x.a)
}));
const LEVELS = [200, 400, 600];
// v3: brand-new question bank. Old 'seen' history and boards are discarded; teams & settings are kept.
const KEY = 'sinjim_state_v3', SEEN_KEY = 'sinjim_seen_v3', SOUND_KEY = 'sinjim_sound';
const DIFF_LABELS = {1:'سهل جدًا',2:'سهل',3:'سهل',4:'متوسط',5:'متوسط',6:'متوسط',7:'صعب',8:'صعب',9:'صعب جدًا',10:'صعب جدًا'};
const DIFF_PRESETS = [['سهل',1,3],['متوسط',4,6],['صعب',7,10],['متدرّج',3,7],['الكل',1,10]];
const COLORS = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316'];
const DEFAULT_NAMES = ['الصقور','النمور','الفرسان','النجوم','الأبطال','العقبان','الذيب','الشهب'];
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const freshState = () => ({
  phase: 'setup',
  teams: [{name: DEFAULT_NAMES[0], color: COLORS[0], score: 0}, {name: DEFAULT_NAMES[1], color: COLORS[1], score: 0}],
  settings: {timer: 60, perLevel: 2, dMin: 3, dMax: 7},
  selected: [],
  board: null,     // [{catId, tiles:[{level,q,a,used,winner}]}]
  turn: 0,
  current: null    // {c, t}
});
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S) { // migrate teams & settings from older versions (but not the old board/questions)
  S = freshState();
  try {
    let old = null;
    for (const k of ['sinjim_state_v2', 'sinjim_state_v1']) { old = JSON.parse(localStorage.getItem(k)); if (old) break; }
    if (old && old.teams && old.teams.length >= 2) S.teams = old.teams.map(t => ({name: t.name, color: t.color, score: 0}));
    if (old && old.settings) Object.assign(S.settings, {timer: old.settings.timer || 60, perLevel: old.settings.perLevel || 2},
      old.settings.dMin ? {dMin: old.settings.dMin, dMax: old.settings.dMax} : {});
  } catch (e) {}
  try { ['sinjim_seen_v1', 'sinjim_state_v1', 'sinjim_seen_v2', 'sinjim_state_v2'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
}
if (!S.teams || S.teams.length < 2) S = freshState();
S.settings = Object.assign({timer: 60, perLevel: 2, dMin: 3, dMax: 7}, S.settings || {});
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';

/* ---------- sound ---------- */
let actx;
function beep(freq = 660, dur = 0.15, type = 'sine', vol = 0.15) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(actx.destination);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) {}
}
const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, .25, 'triangle', .2), i * 160));

/* ---------- scoreboard ---------- */
function renderScores() {
  const sb = $('#scoreboard');
  if (S.phase === 'setup') { sb.innerHTML = ''; return; }
  sb.innerHTML = S.teams.map((t, i) => `
    <div class="team-chip ${S.phase === 'board' && i === S.turn ? 'turn' : ''}" title="${esc(t.name)}">
      <span class="dot" style="background:${t.color}"></span>
      <span class="nm">${esc(t.name)}</span>
      <span class="sc">${t.score}</span>
      ${S.phase === 'board' ? `<span class="adj"><button data-adj="${i}" data-v="100" title="+100">+</button><button data-adj="${i}" data-v="-100" title="-100">−</button></span>` : ''}
    </div>`).join('');
}
$('#scoreboard').addEventListener('click', e => {
  const b = e.target.closest('[data-adj]'); if (!b) return;
  S.teams[+b.dataset.adj].score += +b.dataset.v; save(); renderScores();
});

/* ---------- difficulty control ---------- */
function diffText() {
  const {dMin, dMax} = S.settings;
  return dMin === dMax ? `مستوى ${dMin} فقط (${DIFF_LABELS[dMin]})` : `من ${dMin} (${DIFF_LABELS[dMin]}) إلى ${dMax} (${DIFF_LABELS[dMax]})`;
}
function diffControlHTML() {
  const {dMin, dMax} = S.settings;
  const ticks = Array.from({length: 10}, (_, i) => i + 1).map(n =>
    `<button class="dtick ${n >= dMin && n <= dMax ? 'on' : ''}" data-dtick="${n}" title="${DIFF_LABELS[n]}">${n}</button>`).join('');
  return `
    <div class="diff">
      <div class="diff-summary">🎚️ الصعوبة: <b id="diffText">${diffText()}</b></div>
      <div class="dticks">${ticks}</div>
      <div class="diff-ends"><span>1 = سهل جدًا</span><span>10 = صعب جدًا</span></div>
      <div class="diff-sliders">
        <label>أسهل سؤال: <b id="dMinV">${dMin}</b><input type="range" min="1" max="10" step="1" value="${dMin}" id="dMin"></label>
        <label>أصعب سؤال: <b id="dMaxV">${dMax}</b><input type="range" min="1" max="10" step="1" value="${dMax}" id="dMax"></label>
      </div>
      <div class="diff-presets">${DIFF_PRESETS.map(([n, a, b]) => `<button class="chip ${a === dMin && b === dMax ? 'on' : ''}" data-preset="${a},${b}">${n} (${a}–${b})</button>`).join('')}</div>
      <div class="diff-hint">اضغط رقمين لتحديد نطاق، أو اضغط نفس الرقم مرتين لمستوى واحد. المربعات 200 / 400 / 600 = الثلث الأسهل / الأوسط / الأصعب من النطاق.</div>
    </div>`;
}
let tickAnchor = null;
function refreshDiffUI() { // update in place so sliders keep working while dragging
  const {dMin, dMax} = S.settings;
  app.querySelectorAll('[data-dtick]').forEach(el => { const n = +el.dataset.dtick; el.classList.toggle('on', n >= dMin && n <= dMax); el.classList.toggle('anchor', n === tickAnchor); });
  app.querySelectorAll('[data-preset]').forEach(el => { const [a, b] = el.dataset.preset.split(',').map(Number); el.classList.toggle('on', a === dMin && b === dMax); });
  app.querySelectorAll('#diffText, .diff-summary-mini').forEach(el => el.textContent = diffText());
  const mn = $('#dMin'), mx = $('#dMax');
  if (mn && +mn.value !== dMin) mn.value = dMin; if (mx && +mx.value !== dMax) mx.value = dMax;
  if ($('#dMinV')) $('#dMinV').textContent = dMin; if ($('#dMaxV')) $('#dMaxV').textContent = dMax;
}
function bindDiffControl(extra) {
  const onChange = () => { refreshDiffUI(); extra && extra(); };
  const set = (a, b) => { a = Math.max(1, Math.min(10, a)); b = Math.max(1, Math.min(10, b)); if (a > b) [a, b] = [b, a]; S.settings.dMin = a; S.settings.dMax = b; save(); onChange(); };
  const mn = $('#dMin'), mx = $('#dMax');
  mn.oninput = () => { let a = +mn.value; if (a > S.settings.dMax) { S.settings.dMax = a; } S.settings.dMin = a; save(); onChange(); };
  mx.oninput = () => { let b = +mx.value; if (b < S.settings.dMin) { S.settings.dMin = b; } S.settings.dMax = b; save(); onChange(); };
  app.querySelectorAll('[data-dtick]').forEach(el => el.onclick = () => {
    const n = +el.dataset.dtick;
    if (tickAnchor == null) { tickAnchor = n; set(n, n); } else { const a = tickAnchor; tickAnchor = null; set(a, n); }
  });
  app.querySelectorAll('[data-preset]').forEach(el => el.onclick = () => { tickAnchor = null; const [a, b] = el.dataset.preset.split(',').map(Number); set(a, b); });
}
// which difficulty levels each tile tier (0=200, 1=400, 2=600) should draw from
function tierLevels(k) {
  const {dMin, dMax} = S.settings;
  if (dMin === dMax) return [dMin];
  const span = dMax - dMin, lo = dMin + span * k / 3, hi = dMin + span * (k + 1) / 3;
  const out = [];
  for (let d = Math.ceil(lo - 1e-9); d <= Math.floor(hi + 1e-9); d++) out.push(d);
  return out.length ? out : [Math.round((lo + hi) / 2)];
}
const inRange = c => c.items.filter(x => x.d >= S.settings.dMin && x.d <= S.settings.dMax).length;

/* ---------- setup ---------- */
function renderSetup() {
  app.innerHTML = `
    <h1>تحدي <span class="g">سين جيم</span> 🎉</h1>
    <p class="sub">كوّن الفرق، اختر الفئات، وخلّ المنافسة تبدأ!</p>
    <section class="panel">
      <h2>👥 الفرق (${S.teams.length})</h2>
      <div id="teamList">${S.teams.map((t, i) => `
        <div class="team-row">
          <input type="color" value="${t.color}" data-color="${i}" aria-label="لون الفريق">
          <input type="text" value="${esc(t.name)}" data-name="${i}" maxlength="24" placeholder="اسم الفريق ${i + 1}">
          ${S.teams.length > 2 ? `<button class="rm" data-rm="${i}" title="حذف">🗑️</button>` : ''}
        </div>`).join('')}</div>
      <button class="btn ghost" id="addTeam" ${S.teams.length >= 8 ? 'disabled' : ''}>➕ إضافة فريق</button>
    </section>
    <section class="panel">
      <h2>⚙️ الإعدادات</h2>
      <div class="settings">
        <label>⏱️ وقت السؤال
          <select id="setTimer">${[15, 30, 45, 60, 90, 120, 180].map(v => `<option value="${v}" ${v == S.settings.timer ? 'selected' : ''}>${v} ثانية</option>`).join('')}</select>
        </label>
        <label>🧩 عدد الأسئلة لكل مستوى في كل فئة
          <select id="setPer">${[1, 2, 3].map(v => `<option value="${v}" ${v == S.settings.perLevel ? 'selected' : ''}>${v} (${v * 3} أسئلة للفئة)</option>`).join('')}</select>
        </label>
      </div>
    </section>
    <section class="panel">
      <h2>🎚️ مستوى صعوبة الأسئلة (من 1 إلى 10)</h2>
      <div id="diffBox">${diffControlHTML()}</div>
    </section>
    <div class="center"><button class="btn primary big" id="toCats">التالي: اختيار الفئات ⬅️</button></div>
    <p class="footer-note">يُحفظ تقدم اللعبة تلقائيًا في هذا المتصفح</p>`;
  app.querySelectorAll('[data-name]').forEach(el => el.oninput = () => { S.teams[+el.dataset.name].name = el.value; save(); });
  app.querySelectorAll('[data-color]').forEach(el => el.oninput = () => { S.teams[+el.dataset.color].color = el.value; save(); });
  app.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { S.teams.splice(+el.dataset.rm, 1); save(); render(); });
  $('#addTeam').onclick = () => {
    const n = S.teams.length;
    S.teams.push({name: DEFAULT_NAMES[n] || `فريق ${n + 1}`, color: COLORS[n % COLORS.length], score: 0}); save(); render();
  };
  $('#setTimer').onchange = e => { S.settings.timer = +e.target.value; save(); };
  $('#setPer').onchange = e => { S.settings.perLevel = +e.target.value; save(); };
  bindDiffControl();
  $('#toCats').onclick = () => {
    S.teams.forEach((t, i) => { t.name = (t.name || '').trim() || `فريق ${i + 1}`; });
    S.phase = 'cats'; save(); render();
  };
}

/* ---------- categories ---------- */
function renderCats() {
  const n = S.selected.length;
  app.innerHTML = `
    <h1>اختر <span class="g">الفئات</span></h1>
    <p class="sub">اختر الفئات التي تريد اللعب بها (المقترح 6 فئات)</p>
    <details class="panel diff-panel"><summary>🎚️ الصعوبة: <b class="diff-summary-mini">${diffText()}</b> — اضغط للتغيير</summary><div id="diffBox">${diffControlHTML()}</div></details>
    <div class="cat-grid">${BANK.map(c => {
      return `<div class="cat-card ${S.selected.includes(c.id) ? 'sel' : ''}" data-cat="${c.id}" role="button" tabindex="0">
        <span class="ic">${c.icon}</span><div class="nm">${esc(c.name)}</div><div class="ct"><span data-incount="${c.id}">${inRange(c)}</span> سؤال ضمن الصعوبة · ${c.items.length} إجمالًا</div></div>`;
    }).join('')}</div>
    <div class="sticky-bar">
      <button class="btn ghost" id="backSetup">➡️ رجوع</button>
      <button class="btn ghost" id="randCats">🎲 6 عشوائية</button>
      <span><b id="selCount">${n}</b> فئة مختارة</span>
      <button class="btn primary" id="startGame" ${n < 1 ? 'disabled' : ''}>ابدأ اللعب 🚀</button>
    </div>`;
  app.querySelectorAll('[data-cat]').forEach(el => {
    const toggle = () => {
      const id = el.dataset.cat, i = S.selected.indexOf(id);
      i >= 0 ? S.selected.splice(i, 1) : S.selected.push(id);
      save(); beep(520, .06); render();
    };
    el.onclick = toggle;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
  bindDiffControl(() => app.querySelectorAll('[data-incount]').forEach(el => { el.textContent = inRange(BANK.find(c => c.id === el.dataset.incount)); }));
  $('#backSetup').onclick = () => { S.phase = 'setup'; save(); render(); };
  $('#randCats').onclick = () => { S.selected = shuffle(BANK.map(c => c.id)).slice(0, 6); save(); render(); };
  $('#startGame').onclick = startGame;
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function startGame() {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) {}
  const order = BANK.map(c => c.id).filter(id => S.selected.includes(id));
  S.board = order.map(id => {
    const cat = BANK.find(c => c.id === id), tiles = [], used = new Set();
    const all = cat.items.map(x => ({...x, key: id + '|' + x.q}));
    LEVELS.forEach((l, k) => {
      const want = S.settings.perLevel, target = tierLevels(k);
      const tlo = Math.min(...target), thi = Math.max(...target);
      const dist = x => x.d < tlo ? tlo - x.d : x.d > thi ? x.d - thi : 0;
      const avail = all.filter(x => !used.has(x.key));
      // order: in-tier unseen, in-tier seen, then nearest levels outward (unseen first) — graceful fallback
      const ranked = shuffle(avail).sort((a, b) => (dist(a) - dist(b)) || ((seen[a.key] ? 1 : 0) - (seen[b.key] ? 1 : 0)));
      ranked.slice(0, want).forEach(x => {
        used.add(x.key); seen[x.key] = 1;
        tiles.push({level: l, d: x.d, q: x.q, a: x.a, used: false, winner: null});
      });
    });
    return {catId: id, tiles};
  });
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  S.teams.forEach(t => t.score = 0);
  S.turn = 0; S.current = null; S.phase = 'board'; save(); fanfare(); render();
}

/* ---------- board ---------- */
const catOf = id => BANK.find(c => c.id === id) || {name: id, icon: '❓'};
function renderBoard() {
  const cols = S.board.length, rows = S.board[0] ? S.board[0].tiles.length : 0;
  const t = S.teams[S.turn];
  const left = S.board.reduce((a, c) => a + c.tiles.filter(x => !x.used).length, 0);
  let cells = S.board.map(c => { const k = catOf(c.catId); return `<div class="col-h"><span class="ic">${k.icon}</span>${esc(k.name)}</div>`; }).join('');
  for (let r = 0; r < rows; r++) {
    S.board.forEach((c, ci) => {
      const tile = c.tiles[r];
      if (tile.used) {
        const w = tile.winner != null ? S.teams[tile.winner] : null;
        cells += `<button class="tile used" ${w ? `style="background:${w.color}22;border:2px solid ${w.color}66"` : ''}>${tile.level}<span class="who">${w ? esc(w.name) : '—'}</span></button>`;
      } else cells += `<button class="tile" data-c="${ci}" data-t="${r}">${tile.level}</button>`;
    });
  }
  app.innerHTML = `
    <div class="board-head">
      <div class="turn-banner">🎯 الدور على: <b style="background:${t.color}33;border:2px solid ${t.color}">${esc(t.name)}</b></div>
      <div class="row">
        <span style="color:var(--muted)">متبقي ${left} سؤال</span>
        <button class="btn ghost" id="skipTurn">⏭️ تخطي الدور</button>
        <button class="btn danger" id="endGame">🏁 إنهاء اللعبة</button>
      </div>
    </div>
    <div class="board-wrap"><div class="board" style="grid-template-columns:repeat(${cols},minmax(96px,1fr))">${cells}</div></div>
    <div class="center" style="margin-top:20px"><button class="btn ghost" id="newGame">🔄 لعبة جديدة</button></div>`;
  app.querySelectorAll('.tile[data-c]').forEach(el => el.onclick = () => openQ(+el.dataset.c, +el.dataset.t));
  $('#skipTurn').onclick = () => { nextTurn(); save(); render(); };
  $('#endGame').onclick = () => { if (confirm('إنهاء اللعبة وإعلان النتيجة؟')) { S.phase = 'end'; S.current = null; save(); render(); } };
  $('#newGame').onclick = newGame;
  if (S.current) openQ(S.current.c, S.current.t, true);
}
const nextTurn = () => { S.turn = (S.turn + 1) % S.teams.length; };

/* ---------- question modal ---------- */
let timerId = null, remaining = 0, paused = false;
const RING = 2 * Math.PI * 52;
function openQ(c, t, resume) {
  const col = S.board[c], tile = col.tiles[t], cat = catOf(col.catId), team = S.teams[S.turn];
  S.current = {c, t, revealed: resume && S.current ? !!S.current.revealed : false}; save();
  $('#qCat').textContent = cat.icon + ' ' + cat.name;
  $('#qPts').textContent = tile.level + ' نقطة';
  $('#qDiff').textContent = tile.d ? `الصعوبة ${tile.d}/10 · ${DIFF_LABELS[tile.d]}` : '';
  $('#qTurn').innerHTML = `الدور على <b style="color:${team.color}">${esc(team.name)}</b>`;
  $('#qText').textContent = tile.q;
  $('#qAnswer').textContent = '✅ ' + tile.a;
  $('#awardBtns').innerHTML = S.teams.map((tm, i) => `<button class="btn" data-award="${i}" style="background:${tm.color}33;border-color:${tm.color}">${esc(tm.name)} +${tile.level}</button>`).join('') +
    `<button class="btn danger" data-award="-1">❌ لا أحد</button>`;
  $('#awardBtns').querySelectorAll('[data-award]').forEach(b => b.onclick = () => award(+b.dataset.award));
  setRevealed(S.current.revealed);
  $('#qModal').classList.remove('hidden');
  startTimer(S.settings.timer);
  if (!resume) beep(880, .12);
}
function setRevealed(on) {
  $('#qAnswer').classList.toggle('hidden', !on);
  $('#awardBox').classList.toggle('hidden', !on);
  $('#showABtn').classList.toggle('hidden', on);
  if (on) { stopTimer(); }
}
function startTimer(sec) {
  stopTimer(); remaining = sec; paused = false; $('#pauseBtn').textContent = '⏸️ إيقاف';
  drawTimer();
  if (S.current && S.current.revealed) return;
  timerId = setInterval(() => {
    if (paused) return;
    remaining--; drawTimer();
    if (remaining <= 5 && remaining > 0) beep(990, .08, 'square', .08);
    if (remaining <= 0) { stopTimer(); beep(220, .6, 'sawtooth', .15); $('#tNum').textContent = '⌛'; }
  }, 1000);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }
function drawTimer() {
  const total = S.settings.timer, r = Math.max(remaining, 0);
  $('#tNum').textContent = r;
  $('#tRing').style.strokeDashoffset = RING * (1 - r / total);
  $('.timer-wrap').classList.toggle('low', r <= 10);
}
$('#pauseBtn').onclick = () => { if (!timerId) return; paused = !paused; $('#pauseBtn').textContent = paused ? '▶️ استئناف' : '⏸️ إيقاف'; };
$('#resetTBtn').onclick = () => { if (S.current && !S.current.revealed) startTimer(S.settings.timer); };
$('#showABtn').onclick = () => { S.current.revealed = true; save(); setRevealed(true); beep(700, .15, 'triangle'); };
$('#qClose').onclick = closeQ;
function closeQ() { stopTimer(); S.current = null; save(); $('#qModal').classList.add('hidden'); }
function award(i) {
  const {c, t} = S.current, tile = S.board[c].tiles[t];
  tile.used = true; tile.winner = i >= 0 ? i : null;
  if (i >= 0) { S.teams[i].score += tile.level; fanfare(); miniConfetti(); } else beep(200, .3, 'sawtooth', .1);
  nextTurn(); closeQ();
  const left = S.board.reduce((a, col) => a + col.tiles.filter(x => !x.used).length, 0);
  if (left === 0) S.phase = 'end';
  save(); render();
}
document.addEventListener('keydown', e => {
  if ($('#qModal').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeQ();
  if (e.key === ' ' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); $('#pauseBtn').click(); }
});

/* ---------- end ---------- */
function renderEnd() {
  const ranked = S.teams.map((t, i) => ({...t, i})).sort((a, b) => b.score - a.score);
  const top = ranked[0].score, winners = ranked.filter(t => t.score === top);
  const title = winners.length > 1 ? `تعادل بين ${winners.map(w => esc(w.name)).join(' و ')}! 🤝` : `الفائز: <span class="g">${esc(winners[0].name)}</span>`;
  const medals = ['🥇', '🥈', '🥉'];
  app.innerHTML = `
    <div class="trophy">🏆</div>
    <h1>${title}</h1>
    <p class="sub">مبروك! 🎉 هذه النتيجة النهائية</p>
    <div class="podium">${ranked.map((t, k) => `<div class="rank ${t.score === top ? 'first' : ''}">
      <span class="medal">${t.score === top ? '🥇' : (medals[k] || '🎖️')}</span>
      <span class="dot" style="width:18px;height:18px;border-radius:50%;background:${t.color}"></span>
      <span class="nm">${esc(t.name)}</span><span class="sc">${t.score}</span></div>`).join('')}</div>
    <div class="center">
      <button class="btn primary big" id="again">🔁 جولة جديدة (نفس الفرق)</button>
      <button class="btn ghost" id="newGame">🆕 لعبة جديدة</button>
      ${S.board && S.board.some(c => c.tiles.some(x => !x.used)) ? '<button class="btn ghost" id="backBoard">↩️ رجوع للوحة</button>' : ''}
    </div>`;
  $('#again').onclick = () => { S.phase = 'cats'; S.board = null; S.teams.forEach(t => t.score = 0); save(); render(); };
  $('#newGame').onclick = newGame;
  const bb = $('#backBoard'); if (bb) bb.onclick = () => { S.phase = 'board'; save(); render(); };
  fanfare(); bigConfetti();
}
function newGame() {
  if (S.phase === 'board' && !confirm('بدء لعبة جديدة؟ سيتم مسح التقدم الحالي.')) return;
  const teams = S.teams.map(t => ({...t, score: 0})), settings = S.settings;
  S = freshState(); S.teams = teams; S.settings = settings; save(); render();
}

/* ---------- confetti ---------- */
const cv = $('#confetti'), cx = cv.getContext('2d'); let parts = [], raf = null;
function resize() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; }
addEventListener('resize', resize); resize();
function burst(n, spread) {
  const cols = ['#ffcc33', '#ff9f1c', '#22c55e', '#3b82f6', '#ec4899', '#a855f7', '#fff'];
  for (let i = 0; i < n; i++) parts.push({
    x: cv.width * (spread ? Math.random() : .5), y: spread ? -20 : cv.height * .45,
    vx: (Math.random() - .5) * (spread ? 4 : 22) * devicePixelRatio, vy: (spread ? Math.random() * 3 + 2 : -Math.random() * 18 - 6) * devicePixelRatio,
    s: (Math.random() * 8 + 5) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[i % cols.length], life: 0
  });
  if (!raf) loop();
}
function loop() {
  cx.clearRect(0, 0, cv.width, cv.height);
  parts.forEach(p => { p.vy += .35 * devicePixelRatio; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore(); });
  parts = parts.filter(p => p.y < cv.height + 40 && p.life < 600);
  raf = parts.length ? requestAnimationFrame(loop) : (cx.clearRect(0, 0, cv.width, cv.height), null);
}
const miniConfetti = () => burst(90, false);
function bigConfetti() { burst(160, false); let k = 0; const iv = setInterval(() => { burst(70, true); if (++k > 6) clearInterval(iv); }, 450); }

/* ---------- top actions ---------- */
$('#fsBtn').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); };
const soundIcon = () => $('#soundBtn').textContent = soundOn ? '🔊' : '🔇';
$('#soundBtn').onclick = () => { soundOn = !soundOn; localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); soundIcon(); };
soundIcon();
$('#brandBtn').onclick = () => { if (S.phase !== 'board') { S.phase = 'setup'; save(); render(); } };

/* ---------- router ---------- */
function render() {
  if (S.phase === 'board' && !S.board) S.phase = 'cats';
  if (S.phase !== 'board') { stopTimer(); $('#qModal').classList.add('hidden'); }
  renderScores();
  ({setup: renderSetup, cats: renderCats, board: renderBoard, end: renderEnd}[S.phase] || renderSetup)();
  scrollTo(0, 0);
}
render();
window.__sinjim = {get state() { return S; }};
})();
