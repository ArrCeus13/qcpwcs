// ===== Supabase Project =====
const SUPABASE_URL = "https://gibumqphkfkipbpdfank.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpYnVtcXBoa2ZraXBicGRmYW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3NDYwNDQsImV4cCI6MjA3MTMyMjA0NH0.wBgvTX-iN_LfoUJEesekjTFsZih6u9xRsTNoAaPqJvk";
let supabase = null;

// ===== Global DOM Refs =====
let routeFill, routeAdmin, routeWheel, adminLogin, adminPanel, statusEl, resultBox, resultText, tbody, searchInput, adminStatus, sessionTimerEl;
let rowsSpinBody, wheelCanvas, spinBtn, refreshInvBtn, wheelStatus, wheelResult, invEl;

// ===== Wheel data =====
const PRIZES = [
  { key:'pen',     label:'Pen',         color: css('--pen') },
  { key:'sticky',  label:'Sticky Note', color: css('--sticky') },
  { key:'key',     label:'Key Wallet',  color: css('--key') },
  { key:'tumbler', label:'Tumbler',     color: css('--tumbler') },
  { key:'snack',   label:'Snack',       color: css('--snack') },
];

const SLICES = Array.from({length:4}).flatMap(()=>PRIZES.map(p=>p.key)); // 5*4=20

// Raritas: tumbler (paling langka), key (sedikit di atas), sticky (menengah), snack (tinggi), pen (paling tinggi)
const BASE_WEIGHTS = { tumbler:1, key:2, sticky:4, snack:6, pen:8 };

let inventory = { tumbler:1, key:5, sticky:Infinity, pen:Infinity, snack:Infinity };

let currentAngle = 0;
const seg = (Math.PI * 2) / SLICES.length;

// ===== Boot =====
window.addEventListener("DOMContentLoaded", init);

async function init() {
  routeFill       = byId("route-fill");
  routeAdmin      = byId("route-admin");
  routeWheel      = byId("route-wheel");
  adminLogin      = byId("admin-login");
  adminPanel      = byId("admin-panel");
  statusEl        = byId("status");
  resultBox       = byId("result");
  resultText      = byId("result-text");
  tbody           = byId("rows");
  rowsSpinBody    = byId("rowsSpin");
  searchInput     = byId("search");
  adminStatus     = byId("admin-status");
  sessionTimerEl  = byId("sessionTimer");
  wheelCanvas     = byId("wheel");
  spinBtn         = byId("spinBtn");
  refreshInvBtn   = byId("refreshInv");
  wheelStatus     = byId("wheelStatus");
  wheelResult     = byId("wheelResult");
  invEl           = byId("inv");

  // Router
  window.addEventListener("hashchange", renderRoute);
  renderRoute();

  // Supabase
  await waitForSupabase();

  // Quiz
  bindQuiz();

  // Admin
  bindAdmin();

  // Wheel
  if (wheelCanvas) {
    bindWheel();
  }
}

async function waitForSupabase() {
  const start = Date.now();
  while (!window.supabase && Date.now() - start < 3000) await sleep(50);
  if (!window.supabase) {
    console.warn("Supabase SDK tidak termuat");
    return;
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true },
  });
}

function renderRoute() {
  const hash = window.location.hash || '#/fill';
  [routeFill, routeAdmin, routeWheel].forEach(el => el && el.classList.add('hidden'));

  if (hash.startsWith('#/admin')) {
    routeAdmin.classList.remove('hidden');
    checkAdminSession();
  } else if (hash.startsWith('#/wheel')) {
    routeWheel.classList.remove('hidden');
    drawWheel(); 
    refreshInventory();

    // Prefill panel readonly
    const r = (new URLSearchParams(location.search).get('reg_no')) || localStorage.getItem('tmmin_reg_no') || '';
    const n = (new URLSearchParams(location.search).get('name'))   || localStorage.getItem('tmmin_name')   || '';
    byId('disp_reg').textContent  = r || '-';
    byId('disp_name').textContent = n || '-';

    // Info eligibility
    if (r) isEligible(r).then(ok => {
      wheelStatus.textContent = ok ? 'Eligible: ✔ Lulus quiz 3/3' : 'Not eligible: butuh skor 3/3';
      spinBtn.disabled = !ok;
    });
  } else {
    routeFill.classList.remove('hidden');
  }
}

// ===== Quiz =====
function bindQuiz() {
  const form = byId("quiz-form");
  form.ANSWER_KEY = {
    q1: "Domestic & Oversea",
    q2: "3 Years / 100.000 Km",
    q3: "Labor+Sublet+Part+Handling",
  };
  form.addEventListener("submit", onSubmitQuiz);
}

async function onSubmitQuiz(e) {
  e.preventDefault();
  const form = e.currentTarget;
  setStatus("");

  const name = form.name.value.trim();
  let reg_no = form.reg_no.value.trim().replace(/\s+/g, "");
  const { q1, q2, q3 } = form;

  if (!name || !reg_no || !q1.value || !q2.value || !q3.value) {
    return setStatus("Mohon lengkapi semua kolom.", "error");
  }

  const k = form.ANSWER_KEY;
  const is1 = q1.value === k.q1;
  const is2 = q2.value === k.q2;
  const is3 = q3.value === k.q3;
  const score = [is1, is2, is3].filter(Boolean).length;

  if (!supabase) return setStatus("Supabase belum siap.", "error");

  setStatus("Menyimpan ke Supabase…", "muted");

  const payload = {
    name, reg_no,
    q1: q1.value, q2: q2.value, q3: q3.value,
    is_q1_correct: is1, is_q2_correct: is2, is_q3_correct: is3,
    score
  };

  const { error } = await supabase.from("tmmin_quiz_submissions").insert([payload]);
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (error.code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      setStatus("No Reg sudah pernah mengisi. Satu kali saja.", "error");
    } else if (msg.includes("row-level security")) {
      setStatus("Akses RLS. Coba sign out admin atau beri INSERT utk 'authenticated'.", "error");
    } else {
      setStatus("Gagal menyimpan: " + error.message, "error");
    }
    return;
  }

  // ✅ simpan hanya kalau benar semua
  if (score === 3){
    localStorage.setItem('tmmin_reg_no', reg_no);
    localStorage.setItem('tmmin_name', name);

    // ✅ tambahkan wrapper div biar tidak nempel
    resultText.innerHTML = `
        <p>Terima kasih, ${name}. Skor Anda: ${score}/3.</p>
        <div class="mt">
        <a href="#/wheel" class="btn primary big-btn">🎡 Putar Wheel</a>
        </div>
    `;
    } else {
    localStorage.removeItem('tmmin_reg_no');
    localStorage.removeItem('tmmin_name');
    resultText.innerHTML = `<p>Terima kasih, ${name}. Skor Anda: ${score}/3.</p>`;
  }

  setStatus("Tersimpan!", "success");
  resultBox.classList.remove("hidden");
  form.reset();
}

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = "status" + (type ? " " + type : "");
}

// ===== Admin =====
function bindAdmin() {
  byId("admin-login-form").addEventListener("submit", adminLoginSubmit);
  byId("signOut").addEventListener("click", async () => {
    await supabase?.auth.signOut();
    stopIdleTimer();
    showAdminPanel(false);
  });
  searchInput.addEventListener("input", renderRows);
  byId("exportCsv").addEventListener("click", exportCsv);
}

async function adminLoginSubmit(e) {
  e.preventDefault();
  adminStatus.textContent = "Signing in…";
  adminStatus.className = "status muted";

  const email = e.currentTarget.email.value.trim();
  const password = e.currentTarget.password.value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    adminStatus.textContent = error.message;
    adminStatus.className = "status error";
    return;
  }

  adminStatus.textContent = "";
  await loadTable();
  await loadSpinHistory();
  showAdminPanel(true);
  startIdleTimer();
}

async function checkAdminSession() {
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (session) {
    await loadTable();
    await loadSpinHistory();
    showAdminPanel(true);
    startIdleTimer();
  } else {
    showAdminPanel(false);
  }
}

function showAdminPanel(show) {
  if (show) {
    adminLogin.classList.add("hidden");
    adminPanel.classList.remove("hidden");
  } else {
    adminPanel.classList.add("hidden");
    adminLogin.classList.remove("hidden");
  }
}

async function loadTable() {
  tbody.innerHTML = '<tr><td colspan="7" class="muted">Loading…</td></tr>';

  const { data, error } = await supabase
    .from("tmmin_quiz_submissions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Error: ${error.message}</td></tr>`;
    return;
  }

  window.__ROWS = data || [];
  renderRows();
}

function renderRows() {
  const q = (searchInput.value || "").toLowerCase();
  const src = window.__ROWS || [];
  const rows = src.filter(
    r =>
      !q ||
      `${r.name}`.toLowerCase().includes(q) ||
      `${r.reg_no}`.toLowerCase().includes(q)
  );

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="muted">No data</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      r => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.reg_no)}</td>
        <td>${esc(r.q1)}</td>
        <td>${esc(r.q2)}</td>
        <td>${esc(r.q3)}</td>
        <td><strong>${r.score}/3</strong></td>
      </tr>`
    )
    .join("");
}

function exportCsv() {
  const src = window.__ROWS || [];
  if (!src.length) {
    alert("Tidak ada data.");
    return;
  }

  const headers = [
    "created_at",
    "name",
    "reg_no",
    "q1",
    "q2",
    "q3",
    "is_q1_correct",
    "is_q2_correct",
    "is_q3_correct",
    "score",
  ];

  const csv = [headers.join(",")]
    .concat(src.map(r => headers.map(h => csvEsc(r[h])).join(",")))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tmmin_quiz_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadSpinHistory() {
  rowsSpinBody.innerHTML =
    '<tr><td colspan="4" class="muted">Loading…</td></tr>';

  const { data, error } = await supabase
    .from("spin_results")
    .select("created_at,name,reg_no,prize")
    .order("created_at", { ascending: false });

  if (error) {
    rowsSpinBody.innerHTML = `<tr><td colspan="4" class="muted">${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    rowsSpinBody.innerHTML =
      '<tr><td colspan="4" class="muted">No data</td></tr>';
    return;
  }

  rowsSpinBody.innerHTML = data
    .map(
      r => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.reg_no)}</td>
        <td>${esc(r.prize)}</td>
      </tr>`
    )
    .join("");
}

// ===== Wheel =====
function bindWheel() {
  spinBtn.addEventListener("click", onSpinClick);
  refreshInvBtn.addEventListener("click", refreshInventory);
  drawWheel();
  refreshInventory();

  // 🔑 Tambahkan ini:
  // const regInput = byId('wheel-form').w_reg;
  // regInput.addEventListener('input', async (e) => {
  //   const reg = e.target.value.trim();
  //   if (!reg) {
  //     spinBtn.disabled = true;
  //     wheelStatus.textContent = 'Isi No Reg terlebih dahulu.';
  //     return;
  //   }
  //   const ok = await isEligible(reg);
  //   spinBtn.disabled = !ok;
  //   wheelStatus.textContent = ok ? '' : 'Belum eligible: skor quiz harus 3/3';
  // });
}


function css(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
function byId(id) {
  return document.getElementById(id);
}
function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function csvEsc(v) {
  if (v == null) return "";
  const s = String(v).replaceAll('"', '""');
  return `"${s}"`;
}

const ctx = () => wheelCanvas.getContext("2d");

function drawWheel() {
  if (!wheelCanvas) return;

  const r = wheelCanvas.width / 2;
  const c = ctx();

  c.clearRect(0, 0, wheelCanvas.width, wheelCanvas.height);
  c.save();
  c.translate(r, r);
  c.rotate(currentAngle);

  for (let i = 0; i < SLICES.length; i++) {
    const key = SLICES[i];
    const prize = PRIZES.find(p => p.key === key);

    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r, i * seg, (i + 1) * seg);
    c.closePath();

    c.fillStyle = prize.color;
    c.globalAlpha = 0.92;
    c.fill();
    c.globalAlpha = 1;

    c.strokeStyle = "rgba(15,23,42,.08)";
    c.lineWidth = 2;
    c.stroke();

    c.save();
    c.rotate(i * seg + seg / 2);
    c.textAlign = "right";
    c.fillStyle = "#0f172a";
    c.font = "bold 14px Inter,ui-sans-serif";
    c.fillText(prize.label, r - 14, 5);
    c.restore();
  }
  c.restore();
}

function pickStopAngleForPrize(prizeKey) {
  const idxs = SLICES.map((k, i) => (k === prizeKey ? i : -1)).filter(
    i => i >= 0
  );
  const targetIndex = idxs[Math.floor(Math.random() * idxs.length)];
  const base =
    Math.PI * 2 -
    (targetIndex * seg + seg / 2) +
    (Math.random() * seg * 0.2 - seg * 0.1);
  const spins = 4 + Math.floor(Math.random() * 3);
  return base + spins * 2 * Math.PI;
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function animateSpinTo(total) {
  const start = performance.now();
  const dur = 4000 + Math.random() * 1500;
  const from = currentAngle;
  const to = from + total;

  return new Promise(res => {
    requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      currentAngle = from + (to - from) * easeOut(t);
      drawWheel();
      if (t < 1) requestAnimationFrame(tick);
      else res();
    });
  });
}

async function refreshInventory(){
  const { data } = await supabase.from('spin_inventory').select('prize,remaining');
  if (data) for (const r of data) inventory[r.prize] = r.remaining;
  // invEl.textContent = `Tumbler: ${fmt('tumbler')} | Key Wallet: ${fmt('key')} | Snack: ${fmt('snack')}`;
  invEl.textContent = '';
  drawWheel();
  function fmt(k){ const v = inventory[k]; return v===Infinity?'∞':v; }
}

function makeWeights(){
  const w = { ...BASE_WEIGHTS };
  if (!hasStock('tumbler')) w.tumbler = 0;
  if (!hasStock('key')) w.key = 0;
  return w;
}

function hasStock(k) {
  const v = inventory[k];
  return v === Infinity || (typeof v === "number" && v > 0);
}

function weightedPick(w) {
  const entries = Object.entries(w);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    if ((r -= v) <= 0) return k;
  }
  return "again";
}

async function onSpinClick(){
  const name = (byId('disp_name').textContent || '').trim();
  const reg  = (byId('disp_reg').textContent  || '').trim();
  if (!name || !reg){ wheelStatus.textContent='Nama & No Reg tidak tersedia.'; return; }

  // Wajib lulus
  if (!await isEligible(reg)){ wheelStatus.textContent='Maaf, No Reg ini belum lulus (skor 3/3).'; return; }

  // Pernah menang? (kunci lokal)
  const localWon = localStorage.getItem('wheel_won_reg_no');
  if (localWon && localWon===reg){ wheelStatus.textContent=`No Reg ${reg} sudah mendapatkan hadiah.`; spinBtn.disabled=true; return; }

  spinBtn.disabled=true;
  wheelStatus.textContent='Spinning…'; wheelResult.textContent='';

  const weights    = makeWeights();
  const clientPick = weightedPick(weights);
  const stopAngle  = pickStopAngleForPrize(clientPick);
  await animateSpinTo(stopAngle);

  let finalPrize = clientPick;
  try{
    const { data, error } = await supabase.rpc('spin_take_v3', { p_prize: clientPick, p_reg_no: reg, p_name: name });
    if (error) throw error;
    if (data && data.final_prize) finalPrize = data.final_prize;
  }catch(err){
    const msg = (err.message||'').toLowerCase();
    if (msg.includes('not_eligible')){
      wheelStatus.textContent='Maaf, No Reg ini belum lulus (skor 3/3).';
      spinBtn.disabled=false; return;
    }
    if (msg.includes('already_spin') || msg.includes('unique')){
      wheelStatus.textContent=`No Reg ${reg} sudah pernah mendapatkan hadiah.`;
      spinBtn.disabled=true; return;
    }
    wheelStatus.textContent='Gagal memutar: '+err.message;
    spinBtn.disabled=false; return;
  }

  // Tampilkan & kunci
  const label = PRIZES.find(p=>p.key===finalPrize)?.label || finalPrize;
  wheelResult.textContent = label;
  wheelStatus.textContent = '🎉 Selamat! Anda mendapat: ' + label;
  localStorage.setItem('wheel_won_reg_no', reg);
  spinBtn.disabled = true;

  await refreshInventory();
}

// ===== Idle timer (admin) =====
let idleTimer = null,
  remain = 0;
const MAX = 30 * 60;

function startIdleTimer() {
  stopIdleTimer();
  remain = MAX;
  sessionTimerEl.textContent = fmt(remain);

  idleTimer = setInterval(() => {
    remain -= 1;
    sessionTimerEl.textContent = fmt(remain);
    if (remain <= 0) {
      supabase?.auth.signOut();
      stopIdleTimer();
      showAdminPanel(false);
      alert("Session expired after 30 minutes of inactivity.");
    }
  }, 1000);

  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(e =>
    window.addEventListener(e, reset, { passive: true })
  );
}

function stopIdleTimer() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  sessionTimerEl.textContent = "";
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(e =>
    window.removeEventListener(e, reset)
  );
}

function reset() {
  remain = MAX;
}

function fmt(s) {
  const m = Math.floor(s / 60),
    ss = s % 60;
  return `Auto-logout in ${String(m).padStart(2, "0")}:${String(ss).padStart(
    2,
    "0"
  )}`;
}

// ===== Utils =====
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function isEligible(regNo){
  const { data, error } = await supabase.rpc('is_eligible', { p_reg_no: regNo });
  if (error) {
    console.warn('eligibility rpc error', error);
    return false;
  }
  return !!data; // boolean dari fungsi
}

