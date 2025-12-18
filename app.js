/* app.js */
/* =========================
   Memorize Game (Style v1 + Logic v3 + Firebase)
   Persistent storage: Cloud Firestore (with local cache fallback)
   ========================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Firebase ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyCK1j_ILN12Vok3N6it1dgYNphqJVP0axw",
  authDomain: "memorize-game-bb7e8.firebaseapp.com",
  projectId: "memorize-game-bb7e8",
  storageBucket: "memorize-game-bb7e8.firebasestorage.app",
  messagingSenderId: "16321377204",
  appId: "1:16321377204:web:9645129d023710f6b5f8e1",
  measurementId: "G-CK46BP6YJ3"
};

let FB = {
  app: null,
  auth: null,
  db: null,
  user: null,
  unsub: null,
  saveTimer: null,
  lastCloudClientUpdatedAt: 0,
  lastLocalClientUpdatedAt: 0,
  saving: false
};

function initFirebase() {
  try {
    if (!window.firebase) return false;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    FB.app = firebase.app();
    FB.auth = firebase.auth();
    FB.db = firebase.firestore();
    return true;
  } catch (e) {
    console.error("Firebase init error:", e);
    return false;
  }
}

function cloudDocRef(uid) {
  return FB.db.collection("users").doc(uid);
}

function sanitizeForFirestore(obj) {
  // remove undefined recursively (Firestore doesn't accept undefined)
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === "object") {
    const out = {};
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v === undefined) return;
      out[k] = sanitizeForFirestore(v);
    });
    return out;
  }
  return obj;
}

function scheduleCloudSave() {
  if (!FB.user || !FB.db) return;
  if (FB.saveTimer) clearTimeout(FB.saveTimer);
  FB.saveTimer = setTimeout(() => cloudSaveNow().catch(()=>{}), 500);
}

async function cloudSaveNow() {
  if (!FB.user || !FB.db) return;
  if (FB.saving) return;
  FB.saving = true;

  const uid = FB.user.uid;
  const ref = cloudDocRef(uid);

  const clientUpdatedAt = Date.now();
  FB.lastLocalClientUpdatedAt = clientUpdatedAt;

  const payload = {
    profile: {
      uid,
      email: FB.user.email || null,
      name: FB.user.displayName || null
    },
    state: sanitizeForFirestore(STATE),
    clientUpdatedAt,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    version: 3
  };

  try {
    await ref.set(payload, { merge: true });
  } finally {
    FB.saving = false;
  }
}

async function loadCloudStateOrInit(uid) {
  const ref = cloudDocRef(uid);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() || {};
    const cloudState = data.state;
    const clientUpdatedAt = data.clientUpdatedAt || 0;
    FB.lastCloudClientUpdatedAt = clientUpdatedAt;

    if (cloudState && typeof cloudState === "object") {
      STATE = cloudState;
      // ensure required fields exist (forward compat)
      STATE.meta = STATE.meta || {};
      STATE.wallet = STATE.wallet || { gold: 900, xp: 0 };
      STATE.rank = STATE.rank || { tierIndex: 0, subLevel: 1, progress: 0 };
      STATE.inventory = STATE.inventory || { dateKey: nowISODateKey(), extraCardsBought: 0, extraCardsUsed: 0, skip: 0, help: 0, fuel: 0 };
      STATE.groups = STATE.groups || {};
      STATE.cards = STATE.cards || {};
      STATE.ignoreList = STATE.ignoreList || {};
      STATE.meta.lastActivity = STATE.meta.lastActivity || "تم تحميل بياناتك من السحابة.";
      saveLocalCache(STATE);
      return;
    }
  }

  // no cloud state yet -> upload local cache if exists, otherwise init default
  const cached = loadLocalCache();
  if (cached) {
    STATE = cached;
    STATE.meta = STATE.meta || {};
    STATE.meta.lastActivity = "تم رفع بياناتك المحلية إلى السحابة لأول مرة.";
  } else {
    STATE = defaultState();
    STATE.meta.lastActivity = "تم إنشاء بيانات جديدة على حسابك.";
  }
  saveLocalCache(STATE);
  await cloudSaveNow();
}

function attachCloudListener(uid) {
  if (!FB.db) return;
  if (FB.unsub) FB.unsub();

  const ref = cloudDocRef(uid);
  FB.unsub = ref.onSnapshot((snap) => {
    if (!snap.exists) return;
    const data = snap.data() || {};
    const cloudState = data.state;
    const clientUpdatedAt = data.clientUpdatedAt || 0;

    // ignore if it's our own last write or older than what we have
    if (!cloudState || typeof cloudState !== "object") return;
    if (clientUpdatedAt <= Math.max(FB.lastCloudClientUpdatedAt, FB.lastLocalClientUpdatedAt)) return;

    FB.lastCloudClientUpdatedAt = clientUpdatedAt;
    STATE = cloudState;
    STATE.meta = STATE.meta || {};
    STATE.meta.lastActivity = "تم تحديث بياناتك من جهاز آخر.";
    saveLocalCache(STATE);
    refreshAll();
  });
}

/* ---------- Local cache (fallback only) ---------- */
const STORAGE_KEY = "memorize_game_cache_v3";

function loadLocalCache() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveLocalCache(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

/* ---------- Date helpers ---------- */
function nowISODateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function formatGroupName(dateKey) {
  const [y,m,d] = dateKey.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
function parseDateKey(dateKey){
  const [y,m,d] = dateKey.split("-").map(Number);
  return new Date(y, m-1, d);
}
function daysBetween(aKey, bKey){
  const a = parseDateKey(aKey);
  const b = parseDateKey(bKey);
  const ms = b - a;
  return Math.floor(ms / (1000*60*60*24));
}

/* ---------- Default state ---------- */
function defaultState() {
  const dateKey = nowISODateKey();
  return {
    meta: {
      createdAt: Date.now(),
      lastSeenDateKey: dateKey,
      lastAttendanceDateKey: null,
      streak: 0,
      lastActivity: "لا يوجد.",
      addLockDateKey: null,
      _resolvedDueTodayKey: null
    },
    wallet: { gold: 900, xp: 0 },
    rank: { tierIndex: 0, subLevel: 1, progress: 0 },
    inventory: {
      dateKey,
      extraCardsBought: 0,
      extraCardsUsed: 0,
      skip: 0,
      help: 0,
      fuel: 0
    },
    groups: {},
    cards: {},
    ignoreList: {}
  };
}

/* ---------- Constants ---------- */
const TIERS = ["خشبي","حديدي","نحاسي","فضي","ذهبي","زمردي","بلاتيني","ألماسي","أستاذ","مفكر","حكيم","ملهم"];
const TIER_MAX_SUB = (tierIdx) => {
  if (tierIdx <= 6) return 3;
  if (tierIdx === 7) return 4;
  if (tierIdx === 8) return 5;
  if (tierIdx === 9) return 6;
  if (tierIdx === 10) return 7;
  return 999999;
};

function targetProgressForRank(tierIdx, subLevel) {
  if (tierIdx <= 6) return 120 + (30 * tierIdx) + (15 * (subLevel - 1));
  if (tierIdx === 7) return 400 + (40 * (subLevel - 1));
  if (tierIdx === 8) return 600 + (60 * (subLevel - 1));
  if (tierIdx === 9) return 900 + (90 * (subLevel - 1));
  if (tierIdx === 10) return 1400 + (120 * (subLevel - 1));
  return 2200 + (100 * (subLevel - 1));
}

function difficultyD(rank) {
  const R = rank.tierIndex;
  const S = rank.subLevel;
  return 1 + (0.12 * R) + (0.04 * (S - 1));
}

function levelMultiplier(level) {
  const map = {0:0.80,1:1.00,2:1.10,3:1.25,4:1.40,5:1.60,6:1.85,7:2.20};
  return map[level] ?? 1.00;
}

function speedFactor(sec) {
  if (sec <= 2.0) return 1.30;
  if (sec <= 4.0) return 1.15;
  if (sec <= 7.0) return 1.00;
  if (sec <= 12.0) return 0.80;
  return 0.60;
}

const DUE_LEVELS = new Set([1,3,6,7]);
const MAX_DAILY_BASE = 10;
const MIN_DAILY_FIRST = 4;

/* ---------- Account Level ---------- */
function accountLevelFromXP(xp){
  const lvl = Math.floor(Math.sqrt(Math.max(0, xp) / 500)) + 1;
  const curMinXP = (Math.max(0, (lvl-1)) ** 2) * 500;
  const nextMinXP = (lvl ** 2) * 500;
  return { level: lvl, curMinXP, nextMinXP, toNext: Math.max(0, nextMinXP - xp) };
}

/* ---------- Audio + micro haptics ---------- */
const AudioFX = (() => {
  let ctx = null;
  function init() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  function beep(type="click") {
    try{
      init();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      let freq = 440, dur = 0.06, vol = 0.05;
      if (type==="ok"){freq=660; dur=0.08; vol=0.06;}
      if (type==="bad"){freq=180; dur=0.10; vol=0.07;}
      if (type==="coin"){freq=880; dur=0.05; vol=0.05;}
      if (type==="rank"){freq=520; dur=0.12; vol=0.06;}
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    }catch{}
  }
  function vib(ms){
    try{ if (navigator.vibrate) navigator.vibrate(ms); }catch{}
  }
  return {beep, vib};
})();

function fxToast(text){
  const d = document.createElement("div");
  d.className = "fxToast";
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 900);
}

function pulseEl(el, cls="pop", ms=260){
  if (!el) return;
  el.classList.remove("pop","shake","glowOk");
  el.classList.add(cls);
  setTimeout(()=> el.classList.remove(cls), ms);
}

/* ---------- Modal ---------- */
function openModal(title, bodyHTML, buttons = [], opts = {}) {
  const host = $("#modalHost");
  host.innerHTML = "";

  const modal = document.createElement("div");
  modal.className = "modal";

  const head = document.createElement("div");
  head.className = "modal__head";
  head.innerHTML = `<h3>${escapeHTML(title)}</h3>`;

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn--small btn--ghost";
  closeBtn.innerHTML = `<span class="material-icons">close</span> إغلاق`;
  const closable = opts.closable !== false;
  if (!closable) closeBtn.style.display = "none";
  closeBtn.onclick = () => closeModal();
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.innerHTML = bodyHTML;

  const foot = document.createElement("div");
  foot.className = "rowActions";
  foot.style.marginTop = "12px";
  buttons.forEach(b => foot.appendChild(b));

  modal.appendChild(head);
  modal.appendChild(body);
  if (buttons.length) modal.appendChild(foot);

  host.appendChild(modal);
  host.classList.add("show");

  if (closable) {
    host.onclick = (e) => { if (e.target === host) closeModal(); };
  } else {
    host.onclick = null;
  }
}
function closeModal() {
  const host = $("#modalHost");
  host.classList.remove("show");
  host.innerHTML = "";
}
function makeBtn(htmlText, cls="btn", onClick=()=>{}) {
  const b = document.createElement("button");
  b.className = cls;
  b.type = "button";
  b.innerHTML = htmlText;
  b.onclick = onClick;
  return b;
}

/* ---------- State ---------- */
let STATE = loadLocalCache() || defaultState();

/* ---------- Date safety ---------- */
function safeTodayKey(state) {
  const real = nowISODateKey();
  if (!state.meta.lastSeenDateKey) {
    state.meta.lastSeenDateKey = real;
    return real;
  }
  if (real < state.meta.lastSeenDateKey) {
    return state.meta.lastSeenDateKey;
  }
  state.meta.lastSeenDateKey = real;
  return real;
}

/* ---------- Helpers ---------- */
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function uuid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}
function getTodayGroupKey() {
  return safeTodayKey(STATE);
}
function getOrCreateTodayGroup() {
  const key = getTodayGroupKey();
  if (!STATE.groups[key]) {
    STATE.groups[key] = { id:key, name: formatGroupName(key), dateKey:key, cardIds:[] };
  }
  return STATE.groups[key];
}
function todayCapacity() {
  const extra = Math.min(2, STATE.inventory.extraCardsBought);
  return MAX_DAILY_BASE + extra;
}
function todayCount() {
  const g = STATE.groups[getTodayGroupKey()];
  return g ? g.cardIds.length : 0;
}
function allCardsArray() {
  return Object.values(STATE.cards);
}
function dueCardsToday() {
  return allCardsArray()
    .filter(c => !STATE.ignoreList[c.id])
    .filter(c => DUE_LEVELS.has(c.level));
}
function dueGroupsToday() {
  const due = new Set(dueCardsToday().flatMap(c => c.groupKeys));
  return Array.from(due).map(k => STATE.groups[k]).filter(Boolean);
}

/* ---------- Save wrapper (Cloud first, cache always) ---------- */
function saveState(state) {
  saveLocalCache(state);
  if (FB.user) scheduleCloudSave();
}

/* ---------- Card daily progression ---------- */
function bumpCardLevelsForNewDay(prevDayKey, todayKey){
  if (STATE.meta.lastAttendanceDateKey !== prevDayKey) return;

  Object.values(STATE.cards).forEach(c => {
    if (!c) return;
    if (c.level < 6) c.level += 1;

    const addKey = c.addDateKey || prevDayKey;
    const age = daysBetween(addKey, todayKey);
    if (age >= 30) c.level = 7;
  });
}

/* ---------- Add lock ---------- */
function addLockActiveToday(){
  const today = getTodayGroupKey();
  return STATE.meta.addLockDateKey === today && todayCount() < MIN_DAILY_FIRST;
}
function setAddLockIfNeeded(){
  const today = getTodayGroupKey();
  if (todayCount() >= MIN_DAILY_FIRST) {
    STATE.meta.addLockDateKey = null;
    return;
  }
  STATE.meta.addLockDateKey = today;
}
function clearAddInputs(){
  $("#inFront").value = "";
  $("#inBack").value = "";
  $("#inHint").value = "";
}

/* ---------- Day rollover ---------- */
function ensureDayRollover() {
  const today = safeTodayKey(STATE);
  const prev = STATE.inventory.dateKey;

  if (today !== prev) {
    if (STATE.meta.lastAttendanceDateKey !== prev) {
      if ((STATE.inventory.fuel || 0) > 0) {
        STATE.inventory.fuel -= 1;
        STATE.meta.lastActivity = "تم استخدام 1 وقود لحماية الحماسة من الانطفاء.";
        AudioFX.beep("coin");
      } else {
        STATE.meta.streak = 0;
      }
    }

    bumpCardLevelsForNewDay(prev, today);

    Object.values(STATE.cards).forEach(c => {
      const addKey = c?.addDateKey;
      if (!addKey) return;
      const age = daysBetween(addKey, today);
      if (age >= 30) c.level = 7;
    });

    const unused = Math.max(0, STATE.inventory.extraCardsBought - STATE.inventory.extraCardsUsed);
    if (unused > 0) {
      const refund = Math.floor(unused * 100 * 0.5);
      STATE.wallet.gold += refund;
      STATE.meta.lastActivity = `تمت إعادة ${refund} ذهب (50% من بطاقات إضافية غير مستخدمة).`;
      AudioFX.beep("coin");
    }

    STATE.inventory.dateKey = today;
    STATE.inventory.extraCardsBought = 0;
    STATE.inventory.extraCardsUsed = 0;
    STATE.meta.addLockDateKey = null;
  }

  saveState(STATE);
}

/* ---------- Rank update ---------- */
function applyRatingDelta(delta) {
  if (!delta) return;
  const r = STATE.rank;
  r.progress += delta;

  while (r.progress >= targetProgressForRank(r.tierIndex, r.subLevel)) {
    r.progress -= targetProgressForRank(r.tierIndex, r.subLevel);
    r.subLevel++;
    if (r.subLevel > TIER_MAX_SUB(r.tierIndex)) {
      r.tierIndex++;
      r.subLevel = 1;
      if (r.tierIndex > 11) r.tierIndex = 11;
    }
    AudioFX.beep("rank");
  }

  while (r.progress < 0) {
    if (r.subLevel > 1) {
      r.subLevel--;
      r.progress += targetProgressForRank(r.tierIndex, r.subLevel);
    } else if (r.tierIndex > 0) {
      r.tierIndex--;
      r.subLevel = TIER_MAX_SUB(r.tierIndex);
      r.progress += targetProgressForRank(r.tierIndex, r.subLevel);
    } else {
      r.progress = 0;
      break;
    }
  }
}

/* ---------- UI refresh ---------- */
function refreshHUD() {
  const g = getOrCreateTodayGroup();

  $("#todayLabel").textContent = `مجموعة اليوم: ${g.name}`;
  $("#goldLabel").textContent = STATE.wallet.gold;

  const acc = accountLevelFromXP(STATE.wallet.xp);
  $("#xpLabel").textContent = `LV ${acc.level}`;
  $("#rankLabel").textContent = `${TIERS[STATE.rank.tierIndex]} ${STATE.rank.subLevel}`;
  $("#streakLabel").textContent = STATE.meta.streak;

  const xpPct = Math.max(0, Math.min(100, ((STATE.wallet.xp - acc.curMinXP) / Math.max(1, (acc.nextMinXP - acc.curMinXP))) * 100));
  $("#xpBar").style.width = `${xpPct.toFixed(1)}%`;
  $("#xpSub").textContent = `XP: ${STATE.wallet.xp} (للقادم: ${acc.toNext})`;

  const need = targetProgressForRank(STATE.rank.tierIndex, STATE.rank.subLevel);
  const rankPct = Math.max(0, Math.min(100, (STATE.rank.progress / Math.max(1, need)) * 100));
  $("#rankBar").style.width = `${rankPct.toFixed(1)}%`;
  $("#rankSub").textContent = `تقدّم: ${STATE.rank.progress} / ${need}`;

  const due = dueCardsToday().length;
  const groupsDue = dueGroupsToday().length;
  $("#dueCountLabel").textContent = due;
  $("#dueSub").textContent = `مجموعات مستحقة: ${groupsDue} | سعة اليوم: ${todayCapacity()}`;

  $("#chipSkip").textContent = `تخطي: ${STATE.inventory.skip}`;
  $("#chipHelp").textContent = `مساعدة: ${STATE.inventory.help}`;
  $("#chipFuel").textContent = `وقود: ${STATE.inventory.fuel || 0}`;

  const invExtra = Math.max(0, STATE.inventory.extraCardsBought - STATE.inventory.extraCardsUsed);
  $("#invLine").textContent = `إضافي اليوم: ${invExtra} | تخطي: ${STATE.inventory.skip} | مساعدة: ${STATE.inventory.help} | وقود: ${STATE.inventory.fuel || 0}`;

  const cap = todayCapacity();
  const cnt = todayCount();
  $("#addHint").textContent = `بطاقات اليوم: ${cnt} / ${cap} | أول إضافة: لا خروج قبل ${MIN_DAILY_FIRST} أو حذف وخروج.`;
  $("#addStats").textContent = STATE.meta.lastActivity || "—";

  // Account label
  if (FB.user) {
    $("#userLabel").textContent = FB.user.displayName || FB.user.email || "حسابك";
    $("#accSub").textContent = `مستخدم: ${FB.user.email || "—"}`;
    $("#cloudLine").textContent = "المزامنة فعّالة: أي تغيير يُحفظ في السحابة تلقائيًا.";
  } else {
    $("#userLabel").textContent = "تسجيل الدخول";
    $("#accSub").textContent = "غير مسجل دخول.";
    $("#cloudLine").textContent = "سجّل دخولك لتفعيل الحفظ السحابي.";
  }
}

function refreshTodayList() {
  const g = getOrCreateTodayGroup();
  const list = $("#todayList");
  list.innerHTML = "";

  g.cardIds.slice().reverse().forEach(id => {
    const c = STATE.cards[id];
    if (!c) return;

    const el = document.createElement("div");
    el.className = "cardTile";
    el.innerHTML = `
      <div class="cardTile__row">
        <div class="cardTile__front">${escapeHTML(c.foreign)}</div>
        <div class="badge">مستوى ${c.level}</div>
      </div>
      <div class="cardTile__back">${escapeHTML(c.native)}</div>
      <div class="cardTile__hint">${escapeHTML(c.hint)}</div>
      <div class="badges">
        <span class="badge">${formatGroupName(c.addDateKey)}</span>
        <span class="badge">آخر تقييم: ${escapeHTML(c.lastHintEval || "-")}</span>
      </div>
    `;
    el.onclick = () => el.classList.toggle("open");
    list.appendChild(el);
  });

  if (!g.cardIds.length) {
    list.innerHTML = `<div class="muted">لا توجد بطاقات اليوم بعد.</div>`;
  }
}

function refreshCardsList(filter="") {
  const list = $("#cardsList");
  list.innerHTML = "";

  const f = filter.trim().toLowerCase();
  const cards = allCardsArray()
    .filter(c => {
      if (!f) return true;
      return (c.foreign||"").toLowerCase().includes(f) ||
             (c.native||"").toLowerCase().includes(f) ||
             (c.hint||"").toLowerCase().includes(f);
    })
    .sort((a,b)=> b.addedAt - a.addedAt);

  if (!cards.length) {
    list.innerHTML = `<div class="muted">لا توجد بطاقات.</div>`;
    return;
  }

  cards.forEach(c => {
    const ignored = !!STATE.ignoreList[c.id];
    const el = document.createElement("div");
    el.className = "cardTile";
    el.innerHTML = `
      <div class="cardTile__row">
        <div class="cardTile__front">${escapeHTML(c.foreign)}</div>
        <div class="badge">${ignored ? "متجاهلة" : `مستوى ${c.level}`}</div>
      </div>
      <div class="cardTile__back">${escapeHTML(c.native)}</div>
      <div class="cardTile__hint">${escapeHTML(c.hint)}</div>
      <div class="badges">
        <span class="badge">مجموعات: ${(c.groupKeys||[]).map(k => STATE.groups[k]?.name || k).join("، ")}</span>
        <span class="badge">آخر تقييم: ${escapeHTML(c.lastHintEval || "-")}</span>
      </div>
    `;
    el.onclick = () => {
      openModal("تفاصيل البطاقة", `
        <div class="modalRow">
          <div><b>النص:</b> ${escapeHTML(c.foreign)}</div>
          <div><b>الترجمة:</b> ${escapeHTML(c.native)}</div>
          <div><b>التلميح:</b> ${escapeHTML(c.hint)}</div>
          <div><b>المستوى:</b> ${ignored ? "متجاهلة" : c.level}</div>
          <div><b>آخر تقييم:</b> ${escapeHTML(c.lastHintEval || "-")}</div>
        </div>
      `, [
        makeBtn(`<span class="material-icons">visibility_off</span> ${ignored ? "إلغاء التجاهل" : "تجاهل"}`, "btn btn--primary", () => {
          if (ignored) delete STATE.ignoreList[c.id];
          else STATE.ignoreList[c.id] = true;
          STATE.meta.lastActivity = "تم تحديث قائمة التجاهل.";
          saveState(STATE);
          closeModal();
          refreshHUD();
          refreshCardsList($("#cardsSearch").value);
        }),
        makeBtn(`<span class="material-icons">close</span> إغلاق`, "btn", closeModal)
      ]);
    };
    list.appendChild(el);
  });
}

/* ---------- Views ---------- */
function showView(name) {
  $$(".view").forEach(v => v.classList.remove("active"));
  const target = $(`#view-${name}`);
  if (target) target.classList.add("active");

  $$(".nav__btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));

  if (name === "add") {
    clearAddInputs();
    refreshTodayList();
  }
  if (name === "cards") refreshCardsList($("#cardsSearch").value || "");
  refreshHUD();
}

/* ---------- Help texts ---------- */
const HELP_TEXTS = {
  foreignHelp: "أدخل الكلمة/الجملة باللغة التي تتعلمها. الحقل إلزامي. حد 45 حرف.",
  nativeHelp: "أدخل الترجمة/التوضيح بلغتك. الحقل إلزامي. حد 45 حرف.",
  hintHelp: "أدخل تلميحًا يساعد التذكر (رمز/وصف). الحقل إلزامي. حد 60 حرف."
};

/* ---------- Auth Guard ---------- */
function requireLoginOrGoAccount(actionLabel="هذه الميزة") {
  if (FB.user) return true;
  AudioFX.beep("bad");
  openModal("تسجيل الدخول مطلوب", `${escapeHTML(actionLabel)} يتطلب تسجيل الدخول لحفظ بياناتك على السحابة.`, [
    makeBtn("الذهاب للحساب","btn btn--primary", ()=>{ closeModal(); showView("account"); }),
    makeBtn("إغلاق","btn", closeModal)
  ]);
  return false;
}

/* ---------- Add flow ---------- */
function canExitAddView() {
  return !addLockActiveToday();
}
function deleteTodayProgressAndExit() {
  const key = getTodayGroupKey();
  const g = STATE.groups[key];
  if (g) {
    g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
    g.cardIds = [];
  }
  clearAddInputs();
  STATE.meta.addLockDateKey = null;
  STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة.";
  saveState(STATE);
  closeModal();
  showView("home");
}
function confirmExitAddView() {
  if (canExitAddView()) { showView("home"); return; }
  openModal("تنبيه", `يجب حفظ <b>${MIN_DAILY_FIRST}</b> بطاقات على الأقل قبل الخروج.`, [
    makeBtn("حسنًا","btn btn--primary", closeModal),
    makeBtn("حذف وخروج","btn btn--danger", deleteTodayProgressAndExit)
  ], { closable:false });
}
function setLockOnAnyInput(){
  const a = $("#inFront").value.trim();
  const b = $("#inBack").value.trim();
  const c = $("#inHint").value.trim();
  if (a || b || c) {
    setAddLockIfNeeded();
    saveState(STATE);
  }
}
function saveNewCard() {
  if (!requireLoginOrGoAccount("إضافة البطاقات")) return;

  const foreign = $("#inFront").value.trim();
  const native = $("#inBack").value.trim();
  const hint = $("#inHint").value.trim();

  if (!foreign || !native || !hint) {
    AudioFX.beep("bad");
    openModal("خطأ", "جميع الحقول إلزامية.", [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }

  setAddLockIfNeeded();

  const cap = todayCapacity();
  const cnt = todayCount();
  if (cnt >= cap) {
    AudioFX.beep("bad");
    openModal("تنبيه", `وصلت للحد اليومي (${cap}).`, [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }

  const g = getOrCreateTodayGroup();
  const id = uuid();
  const today = getTodayGroupKey();

  const card = {
    id,
    foreign,
    native,
    hint,
    groupKeys: [today],
    level: 0,
    addedAt: Date.now(),
    addDateKey: today,
    lastHintEval: null,
    lastHintEvalAt: null
  };

  STATE.cards[id] = card;
  g.cardIds.push(id);

  if (g.cardIds.length > MAX_DAILY_BASE) {
    const over = g.cardIds.length - MAX_DAILY_BASE;
    STATE.inventory.extraCardsUsed = Math.max(STATE.inventory.extraCardsUsed, over);
  }

  if (g.cardIds.length >= MIN_DAILY_FIRST) STATE.meta.addLockDateKey = null;

  STATE.meta.lastActivity = `تمت إضافة بطاقة جديدة إلى مجموعة ${g.name}.`;
  saveState(STATE);

  clearAddInputs();
  AudioFX.beep("ok");
  AudioFX.vib(20);
  refreshHUD();
  refreshTodayList();
}

/* ---------- Overdue modal (mandatory) ---------- */
function checkOverdueModal() {
  const today = safeTodayKey(STATE);
  const dueGroups = dueGroupsToday();
  if (dueGroups.length === 0) return;

  if (STATE.meta._resolvedDueTodayKey === today) return;
  if (STATE.meta.lastAttendanceDateKey === today) return;

  const decisions = {};
  let body = `<div class="muted" style="margin-bottom:10px">لديك مجموعات يومية مستحقة. اختر إجراءً لكل مجموعة ثم اضغط "حسنًا".</div>`;

  dueGroups.forEach(g => {
    body += `
      <div class="modalRow">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <div style="font-weight:900">لقد فوّت المجموعة <b>${escapeHTML(g.name)}</b>. هل تود مراجعتها؟</div>
          <span class="badge">مستحقة</span>
        </div>
        <div class="choiceRow">
          <button class="choiceBtn" data-k="${g.id}" data-v="review">مراجعة</button>
          <button class="choiceBtn" data-k="${g.id}" data-v="reset">إعادة</button>
          <button class="choiceBtn" data-k="${g.id}" data-v="ignore">تجاهل</button>
        </div>
      </div>
    `;
  });

  const btnAllReview = makeBtn("مراجعة الكل","btn", () => {
    dueGroups.forEach(g => decisions[g.id] = "review");
    syncChoiceUI("review");
  });
  const btnAllReset = makeBtn("إعادة الكل","btn btn--danger", () => {
    dueGroups.forEach(g => decisions[g.id] = "reset");
    syncChoiceUI("reset");
  });
  const btnAllIgnore = makeBtn("تجاهل الكل","btn", () => {
    dueGroups.forEach(g => decisions[g.id] = "ignore");
    syncChoiceUI("ignore");
  });

  const ok = makeBtn("حسنًا","btn btn--primary", () => {
    const missing = dueGroups.filter(g => !decisions[g.id]);
    if (missing.length) { AudioFX.beep("bad"); return; }

    dueGroups.forEach(g => {
      const d = decisions[g.id];
      if (d === "reset") {
        g.cardIds.forEach(id => { const c = STATE.cards[id]; if (c) c.level = 0; });
      } else if (d === "ignore") {
        g.cardIds.forEach(id => STATE.ignoreList[id] = true);
      }
    });

    STATE.meta._resolvedDueTodayKey = today;
    STATE.meta.lastActivity = "تم تحديد إجراء للمجموعات المستحقة.";
    saveState(STATE);
    closeModal();
    refreshHUD();
  });

  openModal("مجموعات مستحقة", body, [btnAllReview, btnAllReset, btnAllIgnore, ok], { closable:false });

  $("#modalHost").querySelectorAll("button.choiceBtn[data-k]").forEach(b => {
    b.onclick = () => {
      const k = b.getAttribute("data-k");
      const v = b.getAttribute("data-v");
      decisions[k] = v;
      const row = b.closest(".modalRow");
      row.querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      AudioFX.beep("click");
    };
  });

  function syncChoiceUI(which){
    $("#modalHost").querySelectorAll(".modalRow").forEach(row => {
      row.querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("on"));
      const btn = row.querySelector(`.choiceBtn[data-v="${which}"]`);
      if (btn) btn.classList.add("on");
    });
  }
}

/* ---------- Lesson / Games ---------- */
let PLAY = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function buildLessonCards() {
  return dueCardsToday();
}

function startLesson() {
  if (!requireLoginOrGoAccount("اللعب")) return;

  const cards = buildLessonCards();
  if (cards.length === 0) {
    AudioFX.beep("bad");
    openModal("تنبيه", `لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا`, [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }

  const gameQueue = shuffle(["matching","flip","scrambled","typing"]);
  PLAY = {
    timer: null,
    sec: 0,
    goldDelta: 0,
    xpDelta: 0,
    ratingDelta: 0,
    usedHelpInGame: false,
    cards,
    gameQueue,
    playedGames: [],
    inHint: false,
    scrambledIds: [],
    typingIds: [],
    hintIndex: 0,
    completedHintAll: false,
    helpLogs: { matching:[], flip:[], scrambled:[], typing:[] },
    currentGame: null
  };

  const dueIds = cards.map(c=>c.id);
  const thirty = Math.max(1, Math.round(dueIds.length * 0.30));
  const pick1 = shuffle(dueIds).slice(0, thirty);
  const remain = dueIds.filter(id => !pick1.includes(id));
  const pick2 = shuffle(remain).slice(0, Math.min(thirty, remain.length));
  PLAY.scrambledIds = pick1;
  PLAY.typingIds = pick2;

  showView("game");
  $("#btnNextGame").style.display = "";
  $("#btnGoHint").style.display = "";
  $("#btnUseSkip").style.display = "";
  $("#btnUseHelp").style.display = "";
  $("#btnHelpLog").style.display = "";

  updateHUD();
  startTimer();
  launchNextGame();
}

function startTimer() {
  stopTimer();
  PLAY.sec = 0;
  $("#hudTime").textContent = "0.0s";
  PLAY.timer = setInterval(() => {
    PLAY.sec += 0.1;
    $("#hudTime").textContent = `${PLAY.sec.toFixed(1)}s`;
  }, 100);
}
function stopTimer() {
  if (PLAY?.timer) clearInterval(PLAY.timer);
  if (PLAY) PLAY.timer = null;
}

function updateHUD() {
  $("#hudGold").textContent = (PLAY.goldDelta>=0?"+":"") + PLAY.goldDelta;
  $("#hudXP").textContent = (PLAY.xpDelta>=0?"+":"") + PLAY.xpDelta;
  $("#hudRate").textContent = (PLAY.ratingDelta>=0?"+":"") + PLAY.ratingDelta;
  refreshHUD();
}

function currentAverageLevelMultiplier() {
  const lvls = PLAY.cards.map(c => levelMultiplier(c.level));
  return lvls.reduce((a,b)=>a+b,0) / Math.max(1, lvls.length);
}

function applyPerfectGameRewards() {
  const L = currentAverageLevelMultiplier();
  const D = difficultyD(STATE.rank);
  PLAY.goldDelta += 75;
  PLAY.xpDelta += Math.round(220 * L);
  PLAY.ratingDelta += Math.round((60 * L) / D);
  AudioFX.beep("coin");
  AudioFX.vib(15);
  fxToast("مكافأة مثالية");
  updateHUD();
}

function consumeSkipOrAskBuy() {
  if (STATE.inventory.skip <= 0) {
    AudioFX.beep("bad");
    openModal("لا يوجد تخطي", "لا تملك تخطي. يمكن شراؤه من المتجر.", [
      makeBtn("الذهاب للمتجر","btn btn--primary", ()=>{ closeModal(); showView("store"); }),
      makeBtn("إغلاق","btn", closeModal)
    ]);
    return false;
  }
  return true;
}
function consumeHelpOrAskBuy() {
  if (STATE.inventory.help <= 0) {
    AudioFX.beep("bad");
    openModal("لا توجد مساعدة", "لا تملك مساعدات. يمكن شراؤها من المتجر.", [
      makeBtn("الذهاب للمتجر","btn btn--primary", ()=>{ closeModal(); showView("store"); }),
      makeBtn("إغلاق","btn", closeModal)
    ]);
    return false;
  }
  return true;
}

function launchNextGame() {
  PLAY.usedHelpInGame = false;
  const next = PLAY.gameQueue.find(g => !PLAY.playedGames.includes(g));
  if (!next) {
    $("#btnNextGame").style.display = "none";
    return;
  }
  renderGame(next);
}

function gameTitle(k) {
  return ({
    matching: "لعبة التوصيل",
    flip: "لعبة قلب البطاقات",
    scrambled: "لعبة ترتيب الأحرف",
    typing: "لعبة الكتابة",
    hint: "لعبة التلميح"
  }[k] || "لعبة");
}
function gameSubtitle(k) {
  return ({
    matching: "اختر النص ثم ترجمته. الصحيح يختفي، والخطأ يسمح بإعادة بلا حدود.",
    flip: "تذكر أماكن النص والترجمة. عرض 5 ثوانٍ ثم قلب.",
    scrambled: "رتب أحرف النص الصحيح. 30% من بطاقات اليوم.",
    typing: "اكتب النص الأصلي عند رؤية الترجمة. 30% مختلفة عن ترتيب الأحرف.",
    hint: "التقييم إلزامي لتسجيل الحضور."
  }[k] || "");
}

function renderGame(gameKey) {
  PLAY.currentGame = gameKey;
  $("#gameArea").innerHTML = "";
  $("#gameTitle").textContent = gameTitle(gameKey);
  $("#gameSub").textContent = gameSubtitle(gameKey);

  $("#btnUseSkip").style.display = (gameKey !== "hint") ? "" : "none";
  $("#btnUseHelp").style.display = (gameKey !== "hint") ? "" : "none";
  $("#btnHelpLog").style.display = (gameKey !== "hint") ? "" : "none";

  $("#btnUseSkip").onclick = () => {
    if (gameKey === "hint") return;
    if (!consumeSkipOrAskBuy()) return;

    openModal("تأكيد التخطي", "هل تريد تخطي هذه اللعبة والحصول على مكاسب مثالية؟", [
      makeBtn("إلغاء","btn", closeModal),
      makeBtn("نعم","btn btn--primary", () => {
        closeModal();
        STATE.inventory.skip -= 1;
        saveState(STATE);
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        afterGameFinished(gameKey);
      })
    ]);
  };

  $("#btnUseHelp").onclick = () => {
    if (gameKey === "hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    saveState(STATE);

    if (gameKey === "matching") matchingHelp();
    if (gameKey === "flip") flipHelp();
    if (gameKey === "scrambled") scrambledHelp();
    if (gameKey === "typing") typingHelp();

    AudioFX.beep("click");
    refreshHUD();
  };

  $("#btnHelpLog").onclick = () => showHelpLog(gameKey);

  if (gameKey === "matching") gameMatching();
  if (gameKey === "flip") gameFlip();
  if (gameKey === "scrambled") gameScrambled();
  if (gameKey === "typing") gameTyping();
  if (gameKey === "hint") gameHint();
}

/* ---------- Scoring ---------- */
function addXP(amount){ PLAY.xpDelta += Math.max(0, amount|0); }
function addGold(amount){ PLAY.goldDelta += (amount|0); }
function addRating(amount){ PLAY.ratingDelta += (amount|0); }

function finalizeGoldWithHelpPenalty(goldRaw, minGold) {
  let g = goldRaw;
  if (PLAY.usedHelpInGame) g = Math.floor(g * 0.85);
  g = Math.max(minGold, Math.min(75, g));
  return g;
}
function awardOnCorrect(baseXP, baseRate, sec, cardLevel) {
  const F = speedFactor(sec);
  const L = levelMultiplier(cardLevel);
  const D = difficultyD(STATE.rank);
  addXP(Math.round(baseXP * F * L * (1 + 0.01*STATE.rank.tierIndex)));
  addRating(Math.round((baseRate * F * L) / D));
}
function awardOnWrong(minXP, baseLoss, cardLevel, errorFactor=1.0) {
  const L = levelMultiplier(cardLevel);
  const D = difficultyD(STATE.rank);
  addXP(Math.round(minXP * L));
  addRating(-Math.round(Math.abs(baseLoss) * errorFactor * L * D));
}
function errorFactorFromErrors(e) {
  if (e >= 10) return 1.7;
  if (e >= 6) return 1.3;
  return 1.0;
}

/* ---------- Matching ---------- */
let MATCH = null;

function gameMatching() {
  const cards = PLAY.cards;
  const tiles = [];
  cards.forEach(c => {
    tiles.push({ id: "f_"+c.id, kind:"f", cid:c.id, text:c.foreign, level:c.level });
    tiles.push({ id: "n_"+c.id, kind:"n", cid:c.id, text:c.native, level:c.level });
  });

  const board = document.createElement("div");
  board.className = "grid";
  $("#gameArea").appendChild(board);

  MATCH = {
    tiles: shuffle(tiles),
    selected: null,
    gone: new Set(),
    errors: 0,
    correct: 0,
    lastActionAt: performance.now(),
    goldRaw: 0,
  };

  MATCH.tiles.forEach(t => {
    const el = document.createElement("div");
    el.className = "tile";
    el.dataset.id = t.id;
    el.textContent = t.text;
    el.onclick = () => matchingClick(t, el);
    board.appendChild(el);
  });
}

function matchingClick(t, el) {
  if (MATCH.gone.has(t.id)) return;

  AudioFX.beep("click");

  if (MATCH.selected && MATCH.selected.id === t.id) {
    MATCH.selected.el.classList.remove("sel");
    MATCH.selected = null;
    return;
  }

  if (!MATCH.selected) {
    MATCH.selected = { ...t, el };
    el.classList.add("sel");
    return;
  }

  const first = MATCH.selected;
  first.el.classList.remove("sel");
  MATCH.selected = null;

  const dt = (performance.now() - MATCH.lastActionAt) / 1000;
  MATCH.lastActionAt = performance.now();

  const samePair = (first.cid === t.cid) && (first.kind !== t.kind);

  if (samePair) {
    MATCH.gone.add(first.id);
    MATCH.gone.add(t.id);
    first.el.classList.add("gone");
    el.classList.add("gone");
    MATCH.correct++;

    awardOnCorrect(12, 6, dt, Math.max(first.level, t.level));
    const F = speedFactor(dt);
    const L = levelMultiplier(Math.max(first.level, t.level));
    MATCH.goldRaw += (3 * F * L);

    AudioFX.beep("ok");
    AudioFX.vib(15);
    fxToast("+");
    if (first.el) pulseEl(first.el, "glowOk", 350);
    if (el) pulseEl(el, "glowOk", 350);

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    awardOnWrong(2, 8, Math.max(first.level, t.level), errorFactorFromErrors(MATCH.errors));
    AudioFX.beep("bad");
    AudioFX.vib(40);
    pulseEl(first.el, "shake", 300);
    pulseEl(el, "shake", 300);
  }

  updateHUD();
}

function finishMatching() {
  const C = Math.max(1, MATCH.correct);
  const E = MATCH.errors;
  const ER = E / C;

  let penalty = 0;
  if (ER > 0.50) penalty = 0.45;
  else if (ER > 0.25) penalty = 0.25;
  else if (ER > 0.10) penalty = 0.10;

  let gold = Math.floor(MATCH.goldRaw * (1 - penalty));
  gold = finalizeGoldWithHelpPenalty(gold, 8);

  addGold(gold);
  AudioFX.beep("coin");
  fxToast(`ذهب +${gold}`);

  PLAY.playedGames.push("matching");
  afterGameFinished("matching");
}

/* ---------- Flip ---------- */
let FLIP = null;

function gameFlip() {
  const cards = PLAY.cards;
  const tiles = [];
  cards.forEach(c => {
    tiles.push({ id:"f_"+c.id, kind:"f", cid:c.id, text:c.foreign, level:c.level });
    tiles.push({ id:"n_"+c.id, kind:"n", cid:c.id, text:c.native, level:c.level });
  });

  const board = document.createElement("div");
  board.className = "grid";
  $("#gameArea").appendChild(board);

  FLIP = {
    tiles: shuffle(tiles),
    open: [],
    locked: false,
    gone: new Set(),
    pairs: 0,
    startAt: performance.now(),
    lastMatchAt: performance.now(),
    goldRaw: 0,
  };

  // show 5 seconds
  tiles.forEach(t => {
    const el = document.createElement("div");
    el.className = "tile";
    el.dataset.id = t.id;
    el.textContent = t.text;
    board.appendChild(el);
  });

  setTimeout(() => {
    board.innerHTML = "";
    FLIP.tiles.forEach(t => {
      const el = document.createElement("div");
      el.className = "tile back";
      el.dataset.id = t.id;
      el.textContent = "●";
      el.onclick = () => flipClick(t, el);
      board.appendChild(el);
    });
  }, 5000);
}

function flipClick(t, el) {
  if (FLIP.locked) return;
  if (FLIP.gone.has(t.id)) return;

  if (FLIP.open.length === 1 && FLIP.open[0].t.id === t.id) {
    el.classList.add("back");
    el.textContent = "●";
    FLIP.open = [];
    return;
  }
  if (FLIP.open.length >= 2) return;

  AudioFX.beep("click");
  el.classList.remove("back");
  el.textContent = t.text;
  pulseEl(el, "pop", 220);
  FLIP.open.push({t, el});

  if (FLIP.open.length === 2) {
    FLIP.locked = true;
    const [a,b] = FLIP.open;
    const same = (a.t.cid === b.t.cid) && (a.t.kind !== b.t.kind);

    if (same) {
      setTimeout(() => {
        a.el.classList.add("gone");
        b.el.classList.add("gone");
        FLIP.gone.add(a.t.id);
        FLIP.gone.add(b.t.id);
        FLIP.pairs++;
        FLIP.open = [];
        FLIP.locked = false;

        const dt = (performance.now() - FLIP.lastMatchAt)/1000;
        FLIP.lastMatchAt = performance.now();

        const sec = dt;
        const F = speedFactor(sec);
        const L = levelMultiplier(Math.max(a.t.level, b.t.level));
        const D = difficultyD(STATE.rank);

        addXP(Math.round(10 * F * L * (1 + 0.01*STATE.rank.tierIndex)));
        addRating(Math.round((5 * F * L)/D));
        FLIP.goldRaw += (3.5 * F * L);

        AudioFX.beep("ok");
        AudioFX.vib(15);
        updateHUD();

        if (FLIP.pairs >= PLAY.cards.length) finishFlip();
      }, 180);
    } else {
      setTimeout(() => {
        pulseEl(a.el, "shake", 320);
        pulseEl(b.el, "shake", 320);
        AudioFX.vib(40);

        a.el.classList.add("back"); a.el.textContent = "●";
        b.el.classList.add("back"); b.el.textContent = "●";
        FLIP.open = [];
        FLIP.locked = false;
        AudioFX.beep("bad");
      }, 900);
    }
  }
}

function finishFlip() {
  const totalSec = (performance.now() - FLIP.startAt)/1000;
  const avgSec = totalSec / Math.max(1, FLIP.pairs);
  if (avgSec > 12) {
    const L = currentAverageLevelMultiplier();
    const D = difficultyD(STATE.rank);
    addRating(-Math.round(20 * L * D));
  }

  let gold = Math.floor(FLIP.goldRaw);
  gold = finalizeGoldWithHelpPenalty(gold, 8);
  addGold(gold);
  AudioFX.beep("coin");
  fxToast(`ذهب +${gold}`);

  PLAY.playedGames.push("flip");
  afterGameFinished("flip");
}

/* ---------- Scrambled ---------- */
let SCR = null;

function gameScrambled() {
  const ids = PLAY.scrambledIds;
  const cards = ids.map(id => STATE.cards[id]).filter(Boolean);
  SCR = { cards, idx: 0, errors: 0, correct: 0, goldRaw: 0, lastAt: performance.now(), answer: "", stack: [], longPressTimer: null, longPressed: false };
  renderScrambledCard();
}

function renderScrambledCard() {
  const area = $("#gameArea");
  area.innerHTML = "";

  if (SCR.idx >= SCR.cards.length) return finishScrambled();

  const c = SCR.cards[SCR.idx];
  const original = c.foreign;
  const chars = original.split("");
  const shuffled = shuffle(chars);
  SCR.answer = "";
  SCR.stack = [];
  SCR.longPressed = false;

  const box = document.createElement("div");
  box.className = "wordBox";
  box.innerHTML = `
    <div class="muted">بطاقة ${SCR.idx+1} من ${SCR.cards.length}</div>
    <div class="answerLine" id="scrAnswer"></div>
    <div class="lettersRow" id="scrLetters"></div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="scrOk"><span class="material-icons">check</span> موافق</button>
      <button class="btn" id="scrClear"><span class="material-icons">backspace</span> حذف</button>
    </div>
    <div class="muted tiny">ملاحظة: ضغطة قصيرة تحذف آخر حرف، وضغطة مطوّلة تمسح الكل.</div>
  `;
  area.appendChild(box);

  const ansEl = $("#scrAnswer");
  const lettersEl = $("#scrLetters");

  const btnRefs = [];
  shuffled.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "letterBtn";
    b.type = "button";
    b.textContent = ch === " " ? "␠" : ch;
    b.onclick = () => {
      SCR.answer += ch;
      ansEl.textContent = SCR.answer;
      b.disabled = true;
      SCR.stack.push(b); // track order
      AudioFX.beep("click");
      pulseEl(b, "pop", 220);
    };
    btnRefs.push(b);
    lettersEl.appendChild(b);
  });

  function deleteLast() {
    if (!SCR.stack.length) return;
    const lastBtn = SCR.stack.pop();
    if (lastBtn) lastBtn.disabled = false;
    SCR.answer = SCR.answer.slice(0, -1);
    ansEl.textContent = SCR.answer;
    AudioFX.beep("click");
    AudioFX.vib(8);
  }

  function clearAll() {
    SCR.stack.forEach(b => { if (b) b.disabled = false; });
    SCR.stack = [];
    SCR.answer = "";
    ansEl.textContent = "";
    AudioFX.beep("bad");
    AudioFX.vib(20);
    fxToast("مسح الكل");
  }

  const clearBtn = $("#scrClear");

  // long press logic
  const LONG_MS = 520;
  clearBtn.addEventListener("pointerdown", () => {
    SCR.longPressed = false;
    SCR.longPressTimer = setTimeout(() => {
      SCR.longPressed = true;
      clearAll();
    }, LONG_MS);
  });
  clearBtn.addEventListener("pointerup", () => {
    if (SCR.longPressTimer) clearTimeout(SCR.longPressTimer);
    if (!SCR.longPressed) deleteLast();
  });
  clearBtn.addEventListener("pointerleave", () => {
    if (SCR.longPressTimer) clearTimeout(SCR.longPressTimer);
  });

  $("#scrOk").onclick = () => {
    const dt = (performance.now() - SCR.lastAt)/1000;
    SCR.lastAt = performance.now();

    if (SCR.answer === original) {
      SCR.correct++;
      awardOnCorrect(14, 7, dt, c.level);
      const F = speedFactor(dt);
      const L = levelMultiplier(c.level);
      SCR.goldRaw += (4 * F * L);

      AudioFX.beep("ok");
      AudioFX.vib(15);
      fxToast("صحيح");
      updateHUD();
      SCR.idx++;
      renderScrambledCard();
    } else {
      SCR.errors++;
      awardOnWrong(2, 9, c.level, errorFactorFromErrors(SCR.errors));
      AudioFX.beep("bad");
      AudioFX.vib(40);
      updateHUD();
      openModal("غير صحيح", "الترتيب غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
    }
  };
}

function finishScrambled() {
  const C = Math.max(1, SCR.correct);
  const E = SCR.errors;
  const ER = E / C;

  let penalty = 0;
  if (ER > 0.50) penalty = 0.45;
  else if (ER > 0.25) penalty = 0.25;
  else if (ER > 0.10) penalty = 0.10;

  let gold = Math.floor(SCR.goldRaw * (1 - penalty));
  gold = finalizeGoldWithHelpPenalty(gold, 6);
  addGold(gold);
  AudioFX.beep("coin");
  fxToast(`ذهب +${gold}`);

  PLAY.playedGames.push("scrambled");
  afterGameFinished("scrambled");
}

/* ---------- Typing ---------- */
let TYP = null;

function normalizeTyping(s){
  // ignore leading/trailing spaces + ignore case
  return String(s ?? "").trim().toLowerCase();
}

function gameTyping() {
  const ids = PLAY.typingIds;
  const cards = ids.map(id => STATE.cards[id]).filter(Boolean);
  TYP = { cards, idx: 0, errors: 0, correct: 0, goldRaw: 0, lastAt: performance.now() };
  renderTypingCard();
}

function renderTypingCard() {
  const area = $("#gameArea");
  area.innerHTML = "";

  if (TYP.idx >= TYP.cards.length) return finishTyping();

  const c = TYP.cards[TYP.idx];
  const box = document.createElement("div");
  box.className = "wordBox";
  box.innerHTML = `
    <div class="muted">بطاقة ${TYP.idx+1} من ${TYP.cards.length}</div>
    <div style="margin-top:10px; font-weight:900; font-size:18px; overflow-wrap:anywhere">${escapeHTML(c.native)}</div>
    <div class="divider"></div>
    <div class="typingBox">
      <div class="muted" style="font-weight:900">اكتب النص الأصلي</div>
      <input id="typeIn" placeholder="اكتب هنا..." />
      <div class="muted tiny">لا فرق بين حروف كبيرة/صغيرة، وتُهمل فراغات البداية والنهاية.</div>
    </div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="typeOk"><span class="material-icons">check</span> موافق</button>
    </div>
  `;
  area.appendChild(box);

  const input = $("#typeIn");
  input.focus();

  $("#typeOk").onclick = () => {
    const dt = (performance.now() - TYP.lastAt)/1000;
    TYP.lastAt = performance.now();

    const v = normalizeTyping(input.value);
    const target = normalizeTyping(c.foreign);

    if (v === target) {
      TYP.correct++;
      awardOnCorrect(16, 8, dt, c.level);
      const F = speedFactor(dt);
      const L = levelMultiplier(c.level);
      TYP.goldRaw += (5 * F * L);

      AudioFX.beep("ok");
      AudioFX.vib(15);
      fxToast("صحيح");
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2, 10, c.level, errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      AudioFX.vib(40);
      updateHUD();
      openModal("غير صحيح", "المحتوى غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
      const boxEl = $("#gameArea .wordBox");
      pulseEl(boxEl, "shake", 320);
    }
  };
}

function finishTyping() {
  const C = Math.max(1, TYP.correct);
  const E = TYP.errors;
  const ER = E / C;

  let penalty = 0;
  if (ER > 0.50) penalty = 0.45;
  else if (ER > 0.25) penalty = 0.25;
  else if (ER > 0.10) penalty = 0.10;

  let gold = Math.floor(TYP.goldRaw * (1 - penalty));
  gold = finalizeGoldWithHelpPenalty(gold, 6);
  addGold(gold);
  AudioFX.beep("coin");
  fxToast(`ذهب +${gold}`);

  PLAY.playedGames.push("typing");
  afterGameFinished("typing");
}

/* ---------- Help effects + log ---------- */
function logHelp(game, text){
  if (!PLAY?.helpLogs?.[game]) return;
  PLAY.helpLogs[game].push({ at: Date.now(), text });
}
function showHelpLog(game){
  if (!PLAY || !PLAY.helpLogs) return;
  const items = (PLAY.helpLogs[game] || []);
  if (!items.length) {
    openModal("سجل المساعدات", "لا توجد مساعدات مستخدمة في هذه اللعبة.", [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }
  const html = items.map((it, i)=>`
    <div class="modalRow">
      <div style="font-weight:900">#${i+1}</div>
      <div class="muted" style="margin-top:6px">${escapeHTML(it.text)}</div>
    </div>
  `).join("");
  openModal("سجل المساعدات", html, [
    makeBtn("إغلاق","btn btn--primary", closeModal)
  ]);
}

function matchingHelp() {
  const remaining = PLAY.cards.filter(c => !STATE.ignoreList[c.id]);
  if (!remaining.length) return;
  const pick = remaining[Math.floor(Math.random()*remaining.length)];
  const tiles = $$("#gameArea .tile").filter(t => !t.classList.contains("gone"));
  const a = tiles.find(x => x.textContent === pick.foreign);
  const b = tiles.find(x => x.textContent === pick.native);

  logHelp("matching", `تم تمييز زوج: "${pick.foreign}" ↔ "${pick.native}"`);
  if (a) a.classList.add("sel");
  if (b) b.classList.add("sel");
  setTimeout(()=>{ if(a) a.classList.remove("sel"); if(b) b.classList.remove("sel"); }, 900);
}

function flipHelp() {
  const tiles = $$("#gameArea .tile");
  tiles.forEach(el => {
    const id = el.dataset.id;
    const t = FLIP?.tiles?.find(x => x.id === id);
    if (!t) return;
    if (FLIP.gone.has(t.id)) return;
    el.classList.remove("back");
    el.textContent = t.text;
  });

  logHelp("flip", "تم كشف البطاقات مؤقتًا لمدة 1.5 ثانية.");

  setTimeout(()=>{
    tiles.forEach(el => {
      const id = el.dataset.id;
      const t = FLIP?.tiles?.find(x => x.id === id);
      if (!t) return;
      if (FLIP.gone.has(t.id)) return;
      if (FLIP.open.some(o => o.t.id === t.id)) return;
      el.classList.add("back");
      el.textContent = "●";
    });
  }, 1500);
}

function scrambledHelp() {
  const c = SCR?.cards?.[SCR.idx];
  if (!c) return;
  const next = c.foreign.charAt(SCR.answer.length);
  logHelp("scrambled", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

function typingHelp() {
  const c = TYP?.cards?.[TYP.idx];
  if (!c) return;
  const input = $("#typeIn");
  if (!input) return;
  const typed = input.value || "";
  const next = c.foreign.charAt(typed.length);
  logHelp("typing", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

/* ---------- After game finished (FIXED) ---------- */
function afterGameFinished(gameKey) {
  const done4 = ["matching","flip","scrambled","typing"].every(g => PLAY.playedGames.includes(g));
  if (done4) $("#btnNextGame").style.display = "none";

  const buttons = [];

  // FIX: لا تعرض "اللعبة التالية" بعد إنهاء الأربع ألعاب
  if (!done4) {
    buttons.push(
      makeBtn(`<span class="material-icons">sports_esports</span> اللعبة التالية`, "btn btn--primary", () => {
        closeModal();
        launchNextGame();
      })
    );
  }

  buttons.push(
    makeBtn(`<span class="material-icons">task_alt</span> تقييم البطاقات`, "btn btn--primary", () => {
      closeModal();
      goToHint();
    })
  );

  openModal("تم إنهاء اللعبة", `
    <div class="modalRow">
      <div class="muted">اللعبة: <b>${escapeHTML(gameTitle(gameKey))}</b></div>
      <div class="muted" style="margin-top:8px">${done4 ? "انتهت الألعاب الأربع. انتقل لتقييم البطاقات." : "يمكنك اختيار اللعبة التالية أو الانتقال لتقييم البطاقات."}</div>
    </div>
  `, buttons);
}

/* ---------- Hint ---------- */
function goToHint() { renderGame("hint"); }

function gameHint() {
  PLAY.inHint = true;
  stopTimer();

  $("#btnNextGame").style.display = "none";
  $("#btnGoHint").style.display = "none";
  $("#btnUseSkip").style.display = "none";
  $("#btnUseHelp").style.display = "none";
  $("#btnHelpLog").style.display = "none";

  PLAY.hintIndex = 0;
  renderHintCard();
}

function renderHintCard() {
  const area = $("#gameArea");
  area.innerHTML = "";

  const cards = PLAY.cards;
  if (PLAY.hintIndex >= cards.length) return finishHintAll();

  const c = cards[PLAY.hintIndex];

  const wrap = document.createElement("div");
  wrap.className = "hintWrap";
  wrap.innerHTML = `
    <div class="hintCard">
      <div class="muted">بطاقة ${PLAY.hintIndex+1} من ${cards.length}</div>
      <div class="divider"></div>
      <div class="hintText">${escapeHTML(c.hint)}</div>
      <div class="rowActions" style="justify-content:center; margin-top:12px">
        <div class="muted" style="font-weight:900">هل عرفتها؟</div>
        <button class="btn btn--primary" id="btnReveal">
          <span class="material-icons">visibility</span> عرض
        </button>
      </div>
      <div id="revealBox" class="reveal">
        <div class="revealRow">
          <div>النص: <b>${escapeHTML(c.foreign)}</b></div>
          <div>الترجمة: <b>${escapeHTML(c.native)}</b></div>
        </div>
      </div>
      <div class="rateRow">
        <button class="btn btn--primary" id="rateEasy">سهل</button>
        <button class="btn" id="rateMid">متوسط</button>
        <button class="btn btn--danger" id="rateHard">صعب</button>
      </div>
    </div>
  `;
  area.appendChild(wrap);

  $("#btnReveal").onclick = () => {
    $("#revealBox").classList.add("open");
    AudioFX.beep("click");
  };

  $("#rateEasy").onclick = () => rateHint(c.id, "سهل");
  $("#rateMid").onclick = () => rateHint(c.id, "متوسط");
  $("#rateHard").onclick = () => rateHint(c.id, "صعب");
}

function rateHint(cardId, evalText) {
  const c = STATE.cards[cardId];
  if (!c) return;

  if (evalText === "صعب") c.level = 0;
  else if (evalText === "متوسط") c.level = (c.level <= 3) ? 0 : 2;

  c.lastHintEval = evalText;
  c.lastHintEvalAt = Date.now();

  PLAY.hintIndex++;
  AudioFX.beep("ok");
  AudioFX.vib(10);
  saveState(STATE);
  renderHintCard();
}

function finishHintAll() {
  PLAY.completedHintAll = true;

  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  const today = safeTodayKey(STATE);
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;
  saveState(STATE);

  AudioFX.beep("coin");
  AudioFX.beep("rank");
  AudioFX.vib(20);

  openModal("انتهى الدرس", `
    <div class="modalRow">
      <div style="font-weight:900; font-size:18px">تم تسجيل الحضور.</div>
      <div class="divider"></div>
      <div class="muted">ذهب: <b>${PLAY.goldDelta}</b></div>
      <div class="muted">XP: <b>${PLAY.xpDelta}</b></div>
      <div class="muted">تقييم: <b>${PLAY.ratingDelta}</b></div>
      <div class="muted" style="margin-top:10px">يمكنك إعادة اللعب اليوم للحصول على إحصائيات جديدة، وآخر تقييم هو المعتمد.</div>
    </div>
  `, [
    makeBtn(`<span class="material-icons">home</span> العودة للرئيسية`, "btn btn--primary", () => {
      closeModal();
      endPlay(true);
    })
  ], { closable:false });
}

/* ---------- Exit play ---------- */
function cancelLesson() {
  if (!PLAY) return;
  PLAY.goldDelta = 0;
  PLAY.xpDelta = 0;
  PLAY.ratingDelta = 0;
}
function endPlay(goHome=false) {
  stopTimer();
  PLAY = null;
  showView("home");
  if (goHome) return;
}
function handleAbortLesson() {
  if (PLAY && !PLAY.completedHintAll) {
    cancelLesson();
    STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
    saveState(STATE);
  }
  endPlay(true);
}

/* ---------- Store ---------- */
function buyExtraCard() {
  if (!requireLoginOrGoAccount("المتجر")) return;

  if (STATE.inventory.extraCardsBought >= 2) {
    AudioFX.beep("bad");
    openModal("تنبيه","وصلت للحد اليومي لشراء البطاقات الإضافية (2).",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  if (STATE.wallet.gold < 100) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 100 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 100;
  STATE.inventory.extraCardsBought += 1;
  STATE.meta.lastActivity = "تم شراء بطاقة إضافية لليوم.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshHUD();
}
function buySkip() {
  if (!requireLoginOrGoAccount("المتجر")) return;

  if (STATE.wallet.gold < 900) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 900 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 900;
  STATE.inventory.skip += 1;
  STATE.meta.lastActivity = "تم شراء تخطي.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshHUD();
}
function buyHelp() {
  if (!requireLoginOrGoAccount("المتجر")) return;

  if (STATE.wallet.gold < 150) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 150 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 150;
  STATE.inventory.help += 1;
  STATE.meta.lastActivity = "تم شراء مساعدة.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshHUD();
}
function buyFuel() {
  if (!requireLoginOrGoAccount("المتجر")) return;

  if (STATE.wallet.gold < 250) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 250 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 250;
  STATE.inventory.fuel = (STATE.inventory.fuel || 0) + 1;
  STATE.meta.lastActivity = "تم شراء وقود.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshHUD();
}

/* ---------- Start play ---------- */
function handleStartPlay() {
  if (!requireLoginOrGoAccount("اللعب")) return;

  const cards = buildLessonCards();
  if (cards.length === 0) {
    AudioFX.beep("bad");
    openModal("تنبيه", "لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا", [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }
  checkOverdueModal();
  startLesson();
}

/* ---------- Export/Import ---------- */
function exportJSON() {
  const data = JSON.stringify(STATE, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "memorize_game_backup.json";
  a.click();
  URL.revokeObjectURL(url);
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      if (!obj.wallet || !obj.cards || !obj.groups) throw new Error("invalid");
      STATE = obj;
      saveState(STATE);
      refreshAll();
      AudioFX.beep("ok");
      openModal("تم", "تم الاستيراد بنجاح.", [
        makeBtn("إغلاق","btn btn--primary", closeModal)
      ]);
    }catch{
      AudioFX.beep("bad");
      openModal("خطأ", "ملف غير صالح.", [
        makeBtn("إغلاق","btn btn--primary", closeModal)
      ]);
    }
  };
  reader.readAsText(file);
}

/* ---------- Before unload rules ---------- */
function enforceAddLockOnUnload() {
  window.addEventListener("beforeunload", () => {
    if (addLockActiveToday()) {
      const key = getTodayGroupKey();
      const g = STATE.groups[key];
      if (g) {
        g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
        g.cardIds = [];
      }
      STATE.meta.addLockDateKey = null;
      STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة بسبب الخروج قبل 4 بطاقات.";
      saveState(STATE);
    }
    if (PLAY && !PLAY.completedHintAll) {
      cancelLesson();
      STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
      saveState(STATE);
    }
  });
}

/* ---------- Auth UI handlers ---------- */
async function googleLogin() {
  if (!FB.auth) return;
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await FB.auth.signInWithPopup(provider);
  } catch (e) {
    if (String(e?.code||"").includes("popup")) {
      await FB.auth.signInWithRedirect(provider);
      return;
    }
    AudioFX.beep("bad");
    openModal("خطأ", `فشل تسجيل الدخول: ${escapeHTML(e?.message || "غير معروف")}`, [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
  }
}

async function emailLogin(isSignup=false) {
  if (!FB.auth) return;
  const email = ($("#accEmail")?.value || "").trim();
  const pass = ($("#accPass")?.value || "");
  if (!email || !pass) {
    AudioFX.beep("bad");
    openModal("تنبيه", "أدخل الإيميل وكلمة المرور.", [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }
  try {
    if (isSignup) await FB.auth.createUserWithEmailAndPassword(email, pass);
    else await FB.auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    AudioFX.beep("bad");
    openModal("خطأ", `فشل العملية: ${escapeHTML(e?.message || "غير معروف")}`, [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
  }
}

async function logout() {
  if (!FB.auth) return;
  try {
    await FB.auth.signOut();
  } catch {}
}

/* ---------- Wire UI ---------- */
function wireUI() {
  // Nav
  $$(".nav__btn").forEach(b => {
    b.onclick = () => {
      AudioFX.beep("click");
      showView(b.dataset.view);
    };
  });

  // HUD auth button
  $("#btnAuth").onclick = () => {
    AudioFX.beep("click");
    showView("account");
  };

  // Home
  $("#btnStartPlay").onclick = () => { AudioFX.beep("click"); handleStartPlay(); };
  $("#btnQuickAdd").onclick = () => { AudioFX.beep("click"); showView("add"); };

  // Add
  $("#btnSaveCard").onclick = () => { AudioFX.beep("click"); saveNewCard(); };
  $("#btnExitAdd").onclick = () => { AudioFX.beep("click"); confirmExitAddView(); };

  ["#inFront","#inBack","#inHint"].forEach(id=>{
    $(id).addEventListener("input", () => setLockOnAnyInput());
  });

  // Store
  $("#view-store").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-buy]");
    if (!btn) return;
    AudioFX.beep("click");
    const k = btn.getAttribute("data-buy");
    if (k === "extraCard") buyExtraCard();
    if (k === "skip") buySkip();
    if (k === "help") buyHelp();
    if (k === "fuel") buyFuel();
  });

  // Cards
  $("#cardsSearch").addEventListener("input", (e)=> refreshCardsList(e.target.value));
  $("#btnExport").onclick = () => { AudioFX.beep("click"); exportJSON(); };
  $("#importFile").addEventListener("change", (e)=> {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = "";
  });

  // Game
  $("#btnAbortLesson").onclick = () => { AudioFX.beep("click"); handleAbortLesson(); };
  $("#btnNextGame").onclick = () => { AudioFX.beep("click"); launchNextGame(); };
  $("#btnGoHint").onclick = () => { AudioFX.beep("click"); goToHint(); };

  // Help ? buttons
  $$(".qBtn").forEach(b => {
    b.onclick = () => {
      AudioFX.beep("click");
      const key = b.getAttribute("data-help");
      openModal("مساعدة", HELP_TEXTS[key] || "لا توجد.", [
        makeBtn("إغلاق","btn btn--primary", closeModal)
      ]);
    };
  });

  // Account
  $("#btnGoogleLogin").onclick = () => { AudioFX.beep("click"); googleLogin(); };
  $("#btnEmailLogin").onclick = () => { AudioFX.beep("click"); emailLogin(false); };
  $("#btnEmailSignup").onclick = () => { AudioFX.beep("click"); emailLogin(true); };
  $("#btnLogout").onclick = () => { AudioFX.beep("click"); logout(); };
}

/* ---------- Refresh all ---------- */
function refreshAll() {
  ensureDayRollover();
  getOrCreateTodayGroup();
  refreshHUD();
  refreshTodayList();
  refreshCardsList($("#cardsSearch")?.value || "");
}

/* ---------- Init ---------- */
(async function init() {
  // init firebase
  initFirebase();

  // UI first
  getOrCreateTodayGroup();
  wireUI();
  enforceAddLockOnUnload();
  refreshAll();

  // Auth flow
  if (FB.auth) {
    FB.auth.onAuthStateChanged(async (user) => {
      FB.user = user || null;

      if (!FB.user) {
        if (FB.unsub) FB.unsub();
        FB.unsub = null;
        refreshHUD();
        return;
      }

      try {
        await loadCloudStateOrInit(FB.user.uid);
        attachCloudListener(FB.user.uid);
        refreshAll();
        checkOverdueModal();
      } catch (e) {
        console.error(e);
        STATE.meta.lastActivity = "تعذر تحميل السحابة، تم استخدام البيانات المحلية.";
        saveLocalCache(STATE);
        refreshAll();
      }
    });

    // handle redirect result (google popup fallback)
    try { await FB.auth.getRedirectResult(); } catch {}
  }

  // If not logged in, go account view once (soft)
  if (!FB.user) {
    showView("account");
  }
})();
