// app.js
import {
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  onSnapshot,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  auth, db,
  stateDocRef,
  userDocRef,
  ensureDefaultState
} from "./firebase.js";

/* =========================
   Helpers
   ========================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

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
function uuid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

/* =========================
   Constants
   ========================= */
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

/* =========================
   Default state (server)
   ========================= */
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

/* =========================
   Audio
   ========================= */
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
      if (type==="ok"){freq=740; dur=0.09; vol=0.06;}
      if (type==="bad"){freq=160; dur=0.11; vol=0.07;}
      if (type==="coin"){freq=920; dur=0.06; vol=0.06;}
      if (type==="rank"){freq=520; dur=0.12; vol=0.06;}
      if (type==="win"){freq=980; dur=0.14; vol=0.06;}

      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    }catch{}
  }
  return {beep};
})();

/* =========================
   Modal
   ========================= */
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

/* =========================
   Cloud State
   ========================= */
let UID = null;
let STATE = null;
let unsubState = null;
let isApplyingRemote = false;
let isSaving = false;
let pendingStartLesson = false;

async function loadCloudState(uid){
  const data = await ensureDefaultState(uid, defaultState());
  // Firestore may return Timestamps/FieldValue placeholders; protect:
  const s = JSON.parse(JSON.stringify(data));
  delete s.updatedAt;
  return s;
}

async function saveCloudState(){
  if (!UID || !STATE) return;
  if (isApplyingRemote) return;
  if (isSaving) return;
  isSaving = true;
  try{
    await setDoc(stateDocRef(UID), {
      ...STATE,
      updatedAt: serverTimestamp()
    }, { merge:true });
  }finally{
    isSaving = false;
  }
}

function subscribeCloudState(uid){
  if (unsubState) unsubState();
  unsubState = onSnapshot(stateDocRef(uid), (snap)=>{
    if (!snap.exists()) return;
    if (!STATE) return;

    // لا نطبق فوق state أثناء اللعب إذا كان في تغييرات حساسة (ممكن لاحقاً)
    const remote = snap.data() || {};
    const clean = JSON.parse(JSON.stringify(remote));
    delete clean.updatedAt;

    // طبق فقط إذا ليس لدينا عملية local في لحظة snapshot
    isApplyingRemote = true;
    STATE = clean;
    isApplyingRemote = false;

    refreshAll();
    if (pendingStartLesson){
      pendingStartLesson = false;
      startLesson();
    }
  });
}

/* =========================
   Auth Guard
   ========================= */
onAuthStateChanged(auth, async (user)=>{
  if (!user) { location.replace("login.html"); return; }

  // منع استخدام password قبل verify
  if (!user.emailVerified && user.providerData?.some(p=>p.providerId==="password")){
    location.replace("verify.html"); return;
  }

  UID = user.uid;

  // load profile name
  const uSnap = await getDoc(userDocRef(UID));
  const prof = uSnap.exists() ? (uSnap.data()||{}) : {};
  const displayName = (prof.displayName || "").trim();
  if (!displayName){
    location.replace("profile.html"); return;
  }
  $("#userLabel").textContent = displayName;

  // load + subscribe state
  STATE = await loadCloudState(UID);
  subscribeCloudState(UID);

  wireUI();
  enforceBeforeUnload();
  refreshAll();
  checkOverdueModal();
});

/* =========================
   Date safety
   ========================= */
function safeTodayKey() {
  const real = nowISODateKey();
  if (!STATE.meta.lastSeenDateKey) {
    STATE.meta.lastSeenDateKey = real;
    return real;
  }
  if (real < STATE.meta.lastSeenDateKey) return STATE.meta.lastSeenDateKey;
  STATE.meta.lastSeenDateKey = real;
  return real;
}

/* =========================
   Core helpers
   ========================= */
function getTodayGroupKey() { return safeTodayKey(); }

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
function allCardsArray() { return Object.values(STATE.cards || {}); }
function dueCardsToday() {
  return allCardsArray()
    .filter(c => c && !STATE.ignoreList?.[c.id])
    .filter(c => DUE_LEVELS.has(c.level));
}
function dueGroupsToday() {
  const due = new Set(dueCardsToday().flatMap(c => c.groupKeys || []));
  return Array.from(due).map(k => STATE.groups[k]).filter(Boolean);
}

/* =========================
   Daily progression + rollover
   ========================= */
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

function ensureDayRollover() {
  const today = safeTodayKey();
  const prev = STATE.inventory.dateKey;

  if (today !== prev) {
    // streak protection
    if (STATE.meta.lastAttendanceDateKey !== prev) {
      if ((STATE.inventory.fuel || 0) > 0) {
        STATE.inventory.fuel -= 1;
        STATE.meta.lastActivity = "تم استخدام 1 وقود لحماية الحماسة.";
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

    // refund unused extra cards
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
}

/* =========================
   Rank
   ========================= */
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

/* =========================
   Account level
   ========================= */
function accountLevelFromXP(xp){
  const lvl = Math.floor(Math.sqrt(Math.max(0, xp) / 500)) + 1;
  const curMinXP = (Math.max(0, (lvl-1)) ** 2) * 500;
  const nextMinXP = (lvl ** 2) * 500;
  return { level: lvl, curMinXP, nextMinXP, toNext: Math.max(0, nextMinXP - xp) };
}

/* =========================
   UI refresh
   ========================= */
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

  if (!g.cardIds.length) list.innerHTML = `<div class="muted">لا توجد بطاقات اليوم بعد.</div>`;
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
        makeBtn(`<span class="material-icons">visibility_off</span> ${ignored ? "إلغاء التجاهل" : "تجاهل"}`, "btn btn--primary", async () => {
          if (ignored) delete STATE.ignoreList[c.id];
          else STATE.ignoreList[c.id] = true;
          STATE.meta.lastActivity = "تم تحديث قائمة التجاهل.";
          await saveCloudState();
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

/* =========================
   Views
   ========================= */
function showView(name) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");

  $$(".nav__btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));

  if (name === "add") {
    clearAddInputs();
    refreshTodayList();
  }
  if (name === "cards") refreshCardsList($("#cardsSearch").value || "");
  refreshHUD();
}

/* =========================
   Help texts
   ========================= */
const HELP_TEXTS = {
  foreignHelp: "أدخل الكلمة/الجملة باللغة التي تتعلمها. الحقل إلزامي. حد 45 حرف.",
  nativeHelp: "أدخل الترجمة/التوضيح بلغتك. الحقل إلزامي. حد 45 حرف.",
  hintHelp: "أدخل تلميحًا يساعد التذكر (رمز/وصف). الحقل إلزامي. حد 60 حرف."
};

/* =========================
   Add lock
   ========================= */
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

/* =========================
   Add flow
   ========================= */
function canExitAddView() { return !addLockActiveToday(); }

async function deleteTodayProgressAndExit() {
  const key = getTodayGroupKey();
  const g = STATE.groups[key];
  if (g) {
    g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
    g.cardIds = [];
  }
  clearAddInputs();
  STATE.meta.addLockDateKey = null;
  STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة.";
  await saveCloudState();
  closeModal();
  showView("home");
}

function confirmExitAddView() {
  if (canExitAddView()) { showView("home"); return; }
  openModal("تنبيه", `يجب حفظ <b>${MIN_DAILY_FIRST}</b> بطاقات على الأقل قبل الخروج.`, [
    makeBtn("حسنًا","btn btn--primary", closeModal),
    makeBtn("حذف وخروج","btn btn--danger", ()=>deleteTodayProgressAndExit())
  ], { closable:false });
}

async function setLockOnAnyInput(){
  const a = $("#inFront").value.trim();
  const b = $("#inBack").value.trim();
  const c = $("#inHint").value.trim();
  if (a || b || c) {
    setAddLockIfNeeded();
    await saveCloudState();
  }
}

async function saveNewCard() {
  const foreign = $("#inFront").value.trim();
  const native = $("#inBack").value.trim();
  const hint = $("#inHint").value.trim();

  if (!foreign || !native || !hint) {
    AudioFX.beep("bad");
    openModal("خطأ", "جميع الحقول إلزامية.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    return;
  }

  setAddLockIfNeeded();

  const cap = todayCapacity();
  const cnt = todayCount();
  if (cnt >= cap) {
    AudioFX.beep("bad");
    openModal("تنبيه", `وصلت للحد اليومي (${cap}).`, [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
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
  await saveCloudState();

  clearAddInputs();
  AudioFX.beep("ok");
  refreshHUD();
  refreshTodayList();
}

/* =========================
   Overdue modal (mandatory)
   ========================= */
function checkOverdueModal() {
  const today = safeTodayKey();
  const dueGroups = dueGroupsToday();
  if (dueGroups.length === 0) return false;

  if (STATE.meta._resolvedDueTodayKey === today) return false;
  if (STATE.meta.lastAttendanceDateKey === today) return false;

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

  const ok = makeBtn("حسنًا","btn btn--primary", async () => {
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
    await saveCloudState();
    closeModal();
    refreshHUD();

    if (pendingStartLesson){
      pendingStartLesson = false;
      startLesson();
    }
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

  return true;
}

/* =========================
   Lesson / Games
   ========================= */
let PLAY = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function buildLessonCards() { return dueCardsToday(); }

function startLesson() {
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
  $("#gameArea")?.classList?.add("fx-pop");
  setTimeout(()=>$("#gameArea")?.classList?.remove("fx-pop"), 220);
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
    matching: "اختر نصًا ثم ترجمته. الصحيح يختفي، والخطأ يسمح بإعادة بلا حدود.",
    flip: "تذكر أماكن النص والترجمة. عرض 5 ثوانٍ ثم قلب.",
    scrambled: "رتب أحرف النص الصحيح. 30% من بطاقات اليوم.",
    typing: "اكتب النص الأصلي عند رؤية الترجمة. لا فرق بين أحرف كبيرة/صغيرة، ولا بين فراغات البداية/النهاية.",
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
      makeBtn("نعم","btn btn--primary", async () => {
        closeModal();
        STATE.inventory.skip -= 1;
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        await saveCloudState();
        afterGameFinished(gameKey);
      })
    ]);
  };

  $("#btnUseHelp").onclick = async () => {
    if (gameKey === "hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    await saveCloudState();

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

/* =========================
   Scoring
   ========================= */
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

/* =========================
   Matching
   ========================= */
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
    $("#gameArea").classList.add("fx-pop");
    setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    awardOnWrong(2, 8, Math.max(first.level, t.level), errorFactorFromErrors(MATCH.errors));
    AudioFX.beep("bad");
    $("#gameArea").classList.add("fx-shake");
    setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
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

  PLAY.playedGames.push("matching");
  afterGameFinished("matching");
}

/* =========================
   Flip
   ========================= */
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
      el.textContent = "✦";
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
    el.textContent = "✦";
    FLIP.open = [];
    return;
  }
  if (FLIP.open.length >= 2) return;

  AudioFX.beep("click");
  el.classList.remove("back");
  el.textContent = t.text;
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
        $("#gameArea").classList.add("fx-pop");
        setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
        updateHUD();

        if (FLIP.pairs >= PLAY.cards.length) finishFlip();
      }, 180);
    } else {
      setTimeout(() => {
        a.el.classList.add("back"); a.el.textContent = "✦";
        b.el.classList.add("back"); b.el.textContent = "✦";
        FLIP.open = [];
        FLIP.locked = false;
        AudioFX.beep("bad");
        $("#gameArea").classList.add("fx-shake");
        setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
      }, 2000);
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

  PLAY.playedGames.push("flip");
  afterGameFinished("flip");
}

/* =========================
   Scrambled (delete last / long-press clear all)
   ========================= */
let SCR = null;

function gameScrambled() {
  const ids = PLAY.scrambledIds;
  const cards = ids.map(id => STATE.cards[id]).filter(Boolean);
  SCR = { cards, idx: 0, errors: 0, correct: 0, goldRaw: 0, lastAt: performance.now(), answer: "" };
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

  const box = document.createElement("div");
  box.className = "wordBox";
  box.innerHTML = `
    <div class="muted">بطاقة ${SCR.idx+1} من ${SCR.cards.length}</div>
    <div class="answerLine" id="scrAnswer"></div>
    <div class="lettersRow" id="scrLetters"></div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="scrOk"><span class="material-icons">check</span> موافق</button>
      <button class="btn" id="scrDel" title="حذف آخر حرف (ضغط مطوّل لمسح الكل)">
        <span class="material-icons">backspace</span> حذف
      </button>
    </div>
    <div class="tiny muted">زر حذف: ضغطة واحدة تحذف آخر حرف. ضغط مطوّل يمسح كل شيء.</div>
  `;
  area.appendChild(box);

  const ansEl = $("#scrAnswer");
  const lettersEl = $("#scrLetters");

  function syncButtons(){
    ansEl.textContent = SCR.answer;
  }

  shuffled.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "letterBtn";
    b.type = "button";
    b.textContent = ch === " " ? "␠" : ch;
    b.onclick = () => {
      SCR.answer += ch;
      syncButtons();
      b.disabled = true;
      AudioFX.beep("click");
    };
    lettersEl.appendChild(b);
  });

  // delete last, long-press clear
  let pressTimer = null;
  const delBtn = $("#scrDel");

  function clearAll(){
    SCR.answer = "";
    syncButtons();
    lettersEl.querySelectorAll("button").forEach(b => b.disabled = false);
    AudioFX.beep("click");
  }
  function deleteLast(){
    if (!SCR.answer.length) return;
    const removed = SCR.answer.slice(-1);
    SCR.answer = SCR.answer.slice(0, -1);
    // re-enable one matching disabled letter (best-effort)
    const disabled = Array.from(lettersEl.querySelectorAll("button:disabled"));
    const btn = disabled.reverse().find(x => (x.textContent === removed || (removed===" " && x.textContent==="␠")));
    if (btn) btn.disabled = false;
    syncButtons();
    AudioFX.beep("click");
  }

  delBtn.addEventListener("mousedown", ()=>{
    pressTimer = setTimeout(()=>{ clearAll(); pressTimer=null; }, 520);
  });
  delBtn.addEventListener("mouseup", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; deleteLast(); }
  });
  delBtn.addEventListener("mouseleave", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; }
  });
  // touch
  delBtn.addEventListener("touchstart", ()=>{
    pressTimer = setTimeout(()=>{ clearAll(); pressTimer=null; }, 520);
  }, {passive:true});
  delBtn.addEventListener("touchend", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; deleteLast(); }
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
      $("#gameArea").classList.add("fx-pop");
      setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
      updateHUD();
      SCR.idx++;
      renderScrambledCard();
    } else {
      SCR.errors++;
      awardOnWrong(2, 9, c.level, errorFactorFromErrors(SCR.errors));
      AudioFX.beep("bad");
      $("#gameArea").classList.add("fx-shake");
      setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
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

  PLAY.playedGames.push("scrambled");
  afterGameFinished("scrambled");
}

/* =========================
   Typing (ignore case + trim)
   ========================= */
let TYP = null;

function normalizeTyping(s){
  // تجاهل الفراغات قبل/بعد + تجاهل حالة الأحرف
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
      <div class="muted tiny">لا فرق بين أحرف كبيرة/صغيرة، ويتم تجاهل فراغات البداية/النهاية.</div>
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
      $("#gameArea").classList.add("fx-pop");
      setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2, 10, c.level, errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      $("#gameArea").classList.add("fx-shake");
      setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
      updateHUD();
      openModal("غير صحيح", "المحتوى غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
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

  PLAY.playedGames.push("typing");
  afterGameFinished("typing");
}

/* =========================
   Help log + effects
   ========================= */
function logHelp(game, text){
  if (!PLAY?.helpLogs?.[game]) return;
  PLAY.helpLogs[game].push({ at: Date.now(), text });
}
function showHelpLog(game){
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
  openModal("سجل المساعدات", html, [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
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
      el.textContent = "✦";
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
  const typed = input.value.trim();
  const next = c.foreign.charAt(typed.length);
  logHelp("typing", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

/* =========================
   After game finished (FIX: hide next button after 4 games, even in modal)
   ========================= */
function afterGameFinished(gameKey) {
  const done4 = ["matching","flip","scrambled","typing"].every(g => PLAY.playedGames.includes(g));
  if (done4) $("#btnNextGame").style.display = "none";

  const buttons = [];

  if (!done4){
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
      <div class="muted" style="margin-top:8px">يمكنك الانتقال للتقييم. ${done4 ? "هذه كانت آخر لعبة قبل التلميح." : ""}</div>
    </div>
  `, buttons);
}

/* =========================
   Hint (no stats)
   ========================= */
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

async function rateHint(cardId, evalText) {
  const c = STATE.cards[cardId];
  if (!c) return;

  if (evalText === "صعب") c.level = 0;
  else if (evalText === "متوسط") c.level = (c.level <= 3) ? 0 : 2;

  c.lastHintEval = evalText;
  c.lastHintEvalAt = Date.now();

  PLAY.hintIndex++;
  AudioFX.beep("ok");
  await saveCloudState();
  renderHintCard();
}

async function finishHintAll() {
  PLAY.completedHintAll = true;

  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  const today = safeTodayKey();
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;
  await saveCloudState();

  AudioFX.beep("win");
  AudioFX.beep("rank");

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

/* =========================
   Abort lesson
   ========================= */
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
async function handleAbortLesson() {
  if (PLAY && !PLAY.completedHintAll) {
    cancelLesson();
    STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
    await saveCloudState();
  }
  endPlay(true);
}

/* =========================
   Store
   ========================= */
async function buyExtraCard() {
  if (STATE.inventory.extraCardsBought >= 2) {
    AudioFX.beep("bad");
    openModal("تنبيه","وصلت للحد اليومي لشراء البطاقات الإضافية (2).",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  if (STATE.wallet.gold < 100) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 100 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 100;
  STATE.inventory.extraCardsBought += 1;
  STATE.meta.lastActivity = "تم شراء بطاقة إضافية لليوم.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buySkip() {
  if (STATE.wallet.gold < 900) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 900 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 900;
  STATE.inventory.skip += 1;
  STATE.meta.lastActivity = "تم شراء تخطي.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buyHelp() {
  if (STATE.wallet.gold < 150) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 150 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 150;
  STATE.inventory.help += 1;
  STATE.meta.lastActivity = "تم شراء مساعدة.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buyFuel() {
  if (STATE.wallet.gold < 250) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 250 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 250;
  STATE.inventory.fuel = (STATE.inventory.fuel || 0) + 1;
  STATE.meta.lastActivity = "تم شراء وقود.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}

/* =========================
   Start play
   ========================= */
function handleStartPlay() {
  const cards = buildLessonCards();
  if (cards.length === 0) {
    AudioFX.beep("bad");
    openModal("تنبيه", "لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا", [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }

  const opened = checkOverdueModal();
  if (opened){
    pendingStartLesson = true;
    return;
  }
  startLesson();
}

/* =========================
   Export/Import (cloud saved)
   ========================= */
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

async function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const obj = JSON.parse(reader.result);
      if (!obj.wallet || !obj.cards || !obj.groups) throw new Error("invalid");
      STATE = obj;
      STATE.meta.lastActivity = "تم استيراد نسخة احتياطية.";
      await saveCloudState();
      refreshAll();
      AudioFX.beep("ok");
      openModal("تم", "تم الاستيراد بنجاح.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    }catch{
      AudioFX.beep("bad");
      openModal("خطأ", "ملف غير صالح.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    }
  };
  reader.readAsText(file);
}

/* =========================
   Before unload rules
   ========================= */
function enforceBeforeUnload() {
  window.addEventListener("beforeunload", async () => {
    // إذا خرج قبل 4 بطاقات: امسح إضافة اليوم (حسب شرطك)
    if (STATE && addLockActiveToday()) {
      const key = getTodayGroupKey();
      const g = STATE.groups[key];
      if (g) {
        g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
        g.cardIds = [];
      }
      STATE.meta.addLockDateKey = null;
      STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة بسبب الخروج قبل 4 بطاقات.";
      await saveCloudState();
    }
    // إذا خرج أثناء الدرس قبل التلميح: إلغاء المكافآت
    if (PLAY && !PLAY.completedHintAll) {
      cancelLesson();
      STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
      await saveCloudState();
    }
  });
}

/* =========================
   Account menu: logout + delete
   ========================= */
async function showAccountMenu(){
  openModal("الحساب", `
    <div class="modalRow">
      <div class="muted">يمكنك تسجيل الخروج أو حذف الحساب نهائيًا.</div>
      <div class="divider"></div>
      <div class="muted tiny">حذف الحساب سيحذف كل بياناتك نهائيًا.</div>
      <div style="margin-top:10px">
        <button class="btn btn--primary" id="mLogout"><span class="material-icons">logout</span> تسجيل الخروج</button>
        <button class="btn btn--ghost" id="mDelete" style="opacity:.65;font-weight:800">حذف الحساب</button>
      </div>
    </div>
  `, [], {closable:true});

  $("#mLogout").onclick = async ()=>{
    await signOut(auth);
    location.replace("login.html");
  };

  $("#mDelete").onclick = ()=>{
    closeModal();
    confirmDeleteAccountStep1();
  };
}

function confirmDeleteAccountStep1(){
  openModal("تأكيد", `
    <div class="modalRow">
      <div style="font-weight:900">هل تريد حذف حسابك؟</div>
      <div class="muted" style="margin-top:6px">هذا الإجراء خطير.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("متابعة","btn btn--danger", ()=>{ closeModal(); confirmDeleteAccountStep2(); })
  ], {closable:false});
}
function confirmDeleteAccountStep2(){
  openModal("تأكيد نهائي", `
    <div class="modalRow">
      <div style="font-weight:900">ستفقد جميع بياناتك نهائيًا.</div>
      <div class="muted" style="margin-top:6px">لا يمكن الاسترجاع بعد الحذف.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("حذف نهائي","btn btn--danger", ()=>{ closeModal(); deleteAccountNow(); })
  ], {closable:false});
}

async function deleteAccountNow(){
  const u = auth.currentUser;
  if (!u) { location.replace("login.html"); return; }

  try{
    // حذف بيانات اللعبة (Doc واحد) + user profile doc
    await deleteDoc(stateDocRef(u.uid));
    await deleteDoc(userDocRef(u.uid));

    // delete user may require recent login
    await deleteUser(u);

    location.replace("signup.html");
  }catch(e){
    const msg = String(e?.message || "");

    // requires recent login
    if (msg.includes("requires-recent-login")){
      await reauthAndDelete();
      return;
    }

    openModal("فشل الحذف", msg || "حدث خطأ.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
  }
}

async function reauthAndDelete(){
  const u = auth.currentUser;
  if (!u) return;

  const providerId = u.providerData?.[0]?.providerId || "";

  try{
    if (providerId === "google.com"){
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
    } else {
      // password: ask for password
      openModal("تأكيد كلمة المرور", `
        <div class="modalRow">
          <div class="muted">أدخل كلمة المرور لإتمام حذف الحساب:</div>
          <div class="divider"></div>
          <input id="reauthPass" type="password" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background: rgba(0,0,0,.22);color: var(--txt);outline:none;" />
          <div class="rowActions" style="margin-top:12px">
            <button class="btn" id="reauthCancel">إلغاء</button>
            <button class="btn btn--danger" id="reauthOk">متابعة الحذف</button>
          </div>
        </div>
      `, [], {closable:false});

      $("#reauthCancel").onclick = closeModal;
      $("#reauthOk").onclick = async ()=>{
        const p = $("#reauthPass").value;
        if (!p) return;
        try{
          const cred = EmailAuthProvider.credential(u.email, p);
          await reauthenticateWithCredential(u, cred);
          closeModal();
        }catch(err){
          openModal("فشل", err?.message || "كلمة المرور غير صحيحة.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
          return;
        }
      };

      // wait a bit for user to complete modal; we rely on next attempt
      return;
    }

    // بعد إعادة التوثيق
    await deleteDoc(stateDocRef(u.uid));
    await deleteDoc(userDocRef(u.uid));
    await deleteUser(u);
    location.replace("signup.html");
  }catch(e){
    openModal("فشل", e?.message || "لم يتم إعادة التوثيق.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
  }
}

/* =========================
   Wire UI
   ========================= */
let wired = false;
function wireUI() {
  if (wired) return;
  wired = true;

  // User pill
  $("#userPill").onclick = ()=>{ AudioFX.beep("click"); showAccountMenu(); };

  // Nav
  $$(".nav__btn").forEach(b => {
    b.onclick = () => {
      AudioFX.beep("click");
      showView(b.dataset.view);
    };
  });

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
}

/* =========================
   Refresh all
   ========================= */
function refreshAll() {
  if (!STATE) return;
  ensureDayRollover();
  getOrCreateTodayGroup();
  refreshHUD();
  refreshTodayList();
  refreshCardsList($("#cardsSearch")?.value || "");
}// app.js
import {
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  reauthenticateWithPopup,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  onSnapshot,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  auth, db,
  stateDocRef,
  userDocRef,
  ensureDefaultState
} from "./firebase.js";

/* =========================
   Helpers
   ========================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

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
function uuid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

/* =========================
   Constants
   ========================= */
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

/* =========================
   Default state (server)
   ========================= */
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

/* =========================
   Audio
   ========================= */
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
      if (type==="ok"){freq=740; dur=0.09; vol=0.06;}
      if (type==="bad"){freq=160; dur=0.11; vol=0.07;}
      if (type==="coin"){freq=920; dur=0.06; vol=0.06;}
      if (type==="rank"){freq=520; dur=0.12; vol=0.06;}
      if (type==="win"){freq=980; dur=0.14; vol=0.06;}

      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur);
    }catch{}
  }
  return {beep};
})();

/* =========================
   Modal
   ========================= */
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

/* =========================
   Cloud State
   ========================= */
let UID = null;
let STATE = null;
let unsubState = null;
let isApplyingRemote = false;
let isSaving = false;
let pendingStartLesson = false;

async function loadCloudState(uid){
  const data = await ensureDefaultState(uid, defaultState());
  // Firestore may return Timestamps/FieldValue placeholders; protect:
  const s = JSON.parse(JSON.stringify(data));
  delete s.updatedAt;
  return s;
}

async function saveCloudState(){
  if (!UID || !STATE) return;
  if (isApplyingRemote) return;
  if (isSaving) return;
  isSaving = true;
  try{
    await setDoc(stateDocRef(UID), {
      ...STATE,
      updatedAt: serverTimestamp()
    }, { merge:true });
  }finally{
    isSaving = false;
  }
}

function subscribeCloudState(uid){
  if (unsubState) unsubState();
  unsubState = onSnapshot(stateDocRef(uid), (snap)=>{
    if (!snap.exists()) return;
    if (!STATE) return;

    // لا نطبق فوق state أثناء اللعب إذا كان في تغييرات حساسة (ممكن لاحقاً)
    const remote = snap.data() || {};
    const clean = JSON.parse(JSON.stringify(remote));
    delete clean.updatedAt;

    // طبق فقط إذا ليس لدينا عملية local في لحظة snapshot
    isApplyingRemote = true;
    STATE = clean;
    isApplyingRemote = false;

    refreshAll();
    if (pendingStartLesson){
      pendingStartLesson = false;
      startLesson();
    }
  });
}

/* =========================
   Auth Guard
   ========================= */
onAuthStateChanged(auth, async (user)=>{
  if (!user) { location.replace("login.html"); return; }

  // منع استخدام password قبل verify
  if (!user.emailVerified && user.providerData?.some(p=>p.providerId==="password")){
    location.replace("verify.html"); return;
  }

  UID = user.uid;

  // load profile name
  const uSnap = await getDoc(userDocRef(UID));
  const prof = uSnap.exists() ? (uSnap.data()||{}) : {};
  const displayName = (prof.displayName || "").trim();
  if (!displayName){
    location.replace("profile.html"); return;
  }
  $("#userLabel").textContent = displayName;

  // load + subscribe state
  STATE = await loadCloudState(UID);
  subscribeCloudState(UID);

  wireUI();
  enforceBeforeUnload();
  refreshAll();
  checkOverdueModal();
});

/* =========================
   Date safety
   ========================= */
function safeTodayKey() {
  const real = nowISODateKey();
  if (!STATE.meta.lastSeenDateKey) {
    STATE.meta.lastSeenDateKey = real;
    return real;
  }
  if (real < STATE.meta.lastSeenDateKey) return STATE.meta.lastSeenDateKey;
  STATE.meta.lastSeenDateKey = real;
  return real;
}

/* =========================
   Core helpers
   ========================= */
function getTodayGroupKey() { return safeTodayKey(); }

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
function allCardsArray() { return Object.values(STATE.cards || {}); }
function dueCardsToday() {
  return allCardsArray()
    .filter(c => c && !STATE.ignoreList?.[c.id])
    .filter(c => DUE_LEVELS.has(c.level));
}
function dueGroupsToday() {
  const due = new Set(dueCardsToday().flatMap(c => c.groupKeys || []));
  return Array.from(due).map(k => STATE.groups[k]).filter(Boolean);
}

/* =========================
   Daily progression + rollover
   ========================= */
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

function ensureDayRollover() {
  const today = safeTodayKey();
  const prev = STATE.inventory.dateKey;

  if (today !== prev) {
    // streak protection
    if (STATE.meta.lastAttendanceDateKey !== prev) {
      if ((STATE.inventory.fuel || 0) > 0) {
        STATE.inventory.fuel -= 1;
        STATE.meta.lastActivity = "تم استخدام 1 وقود لحماية الحماسة.";
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

    // refund unused extra cards
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
}

/* =========================
   Rank
   ========================= */
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

/* =========================
   Account level
   ========================= */
function accountLevelFromXP(xp){
  const lvl = Math.floor(Math.sqrt(Math.max(0, xp) / 500)) + 1;
  const curMinXP = (Math.max(0, (lvl-1)) ** 2) * 500;
  const nextMinXP = (lvl ** 2) * 500;
  return { level: lvl, curMinXP, nextMinXP, toNext: Math.max(0, nextMinXP - xp) };
}

/* =========================
   UI refresh
   ========================= */
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

  if (!g.cardIds.length) list.innerHTML = `<div class="muted">لا توجد بطاقات اليوم بعد.</div>`;
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
        makeBtn(`<span class="material-icons">visibility_off</span> ${ignored ? "إلغاء التجاهل" : "تجاهل"}`, "btn btn--primary", async () => {
          if (ignored) delete STATE.ignoreList[c.id];
          else STATE.ignoreList[c.id] = true;
          STATE.meta.lastActivity = "تم تحديث قائمة التجاهل.";
          await saveCloudState();
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

/* =========================
   Views
   ========================= */
function showView(name) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");

  $$(".nav__btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));

  if (name === "add") {
    clearAddInputs();
    refreshTodayList();
  }
  if (name === "cards") refreshCardsList($("#cardsSearch").value || "");
  refreshHUD();
}

/* =========================
   Help texts
   ========================= */
const HELP_TEXTS = {
  foreignHelp: "أدخل الكلمة/الجملة باللغة التي تتعلمها. الحقل إلزامي. حد 45 حرف.",
  nativeHelp: "أدخل الترجمة/التوضيح بلغتك. الحقل إلزامي. حد 45 حرف.",
  hintHelp: "أدخل تلميحًا يساعد التذكر (رمز/وصف). الحقل إلزامي. حد 60 حرف."
};

/* =========================
   Add lock
   ========================= */
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

/* =========================
   Add flow
   ========================= */
function canExitAddView() { return !addLockActiveToday(); }

async function deleteTodayProgressAndExit() {
  const key = getTodayGroupKey();
  const g = STATE.groups[key];
  if (g) {
    g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
    g.cardIds = [];
  }
  clearAddInputs();
  STATE.meta.addLockDateKey = null;
  STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة.";
  await saveCloudState();
  closeModal();
  showView("home");
}

function confirmExitAddView() {
  if (canExitAddView()) { showView("home"); return; }
  openModal("تنبيه", `يجب حفظ <b>${MIN_DAILY_FIRST}</b> بطاقات على الأقل قبل الخروج.`, [
    makeBtn("حسنًا","btn btn--primary", closeModal),
    makeBtn("حذف وخروج","btn btn--danger", ()=>deleteTodayProgressAndExit())
  ], { closable:false });
}

async function setLockOnAnyInput(){
  const a = $("#inFront").value.trim();
  const b = $("#inBack").value.trim();
  const c = $("#inHint").value.trim();
  if (a || b || c) {
    setAddLockIfNeeded();
    await saveCloudState();
  }
}

async function saveNewCard() {
  const foreign = $("#inFront").value.trim();
  const native = $("#inBack").value.trim();
  const hint = $("#inHint").value.trim();

  if (!foreign || !native || !hint) {
    AudioFX.beep("bad");
    openModal("خطأ", "جميع الحقول إلزامية.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    return;
  }

  setAddLockIfNeeded();

  const cap = todayCapacity();
  const cnt = todayCount();
  if (cnt >= cap) {
    AudioFX.beep("bad");
    openModal("تنبيه", `وصلت للحد اليومي (${cap}).`, [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
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
  await saveCloudState();

  clearAddInputs();
  AudioFX.beep("ok");
  refreshHUD();
  refreshTodayList();
}

/* =========================
   Overdue modal (mandatory)
   ========================= */
function checkOverdueModal() {
  const today = safeTodayKey();
  const dueGroups = dueGroupsToday();
  if (dueGroups.length === 0) return false;

  if (STATE.meta._resolvedDueTodayKey === today) return false;
  if (STATE.meta.lastAttendanceDateKey === today) return false;

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

  const ok = makeBtn("حسنًا","btn btn--primary", async () => {
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
    await saveCloudState();
    closeModal();
    refreshHUD();

    if (pendingStartLesson){
      pendingStartLesson = false;
      startLesson();
    }
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

  return true;
}

/* =========================
   Lesson / Games
   ========================= */
let PLAY = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function buildLessonCards() { return dueCardsToday(); }

function startLesson() {
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
  $("#gameArea")?.classList?.add("fx-pop");
  setTimeout(()=>$("#gameArea")?.classList?.remove("fx-pop"), 220);
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
    matching: "اختر نصًا ثم ترجمته. الصحيح يختفي، والخطأ يسمح بإعادة بلا حدود.",
    flip: "تذكر أماكن النص والترجمة. عرض 5 ثوانٍ ثم قلب.",
    scrambled: "رتب أحرف النص الصحيح. 30% من بطاقات اليوم.",
    typing: "اكتب النص الأصلي عند رؤية الترجمة. لا فرق بين أحرف كبيرة/صغيرة، ولا بين فراغات البداية/النهاية.",
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
      makeBtn("نعم","btn btn--primary", async () => {
        closeModal();
        STATE.inventory.skip -= 1;
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        await saveCloudState();
        afterGameFinished(gameKey);
      })
    ]);
  };

  $("#btnUseHelp").onclick = async () => {
    if (gameKey === "hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    await saveCloudState();

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

/* =========================
   Scoring
   ========================= */
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

/* =========================
   Matching
   ========================= */
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
    $("#gameArea").classList.add("fx-pop");
    setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    awardOnWrong(2, 8, Math.max(first.level, t.level), errorFactorFromErrors(MATCH.errors));
    AudioFX.beep("bad");
    $("#gameArea").classList.add("fx-shake");
    setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
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

  PLAY.playedGames.push("matching");
  afterGameFinished("matching");
}

/* =========================
   Flip
   ========================= */
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
      el.textContent = "✦";
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
    el.textContent = "✦";
    FLIP.open = [];
    return;
  }
  if (FLIP.open.length >= 2) return;

  AudioFX.beep("click");
  el.classList.remove("back");
  el.textContent = t.text;
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
        $("#gameArea").classList.add("fx-pop");
        setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
        updateHUD();

        if (FLIP.pairs >= PLAY.cards.length) finishFlip();
      }, 180);
    } else {
      setTimeout(() => {
        a.el.classList.add("back"); a.el.textContent = "✦";
        b.el.classList.add("back"); b.el.textContent = "✦";
        FLIP.open = [];
        FLIP.locked = false;
        AudioFX.beep("bad");
        $("#gameArea").classList.add("fx-shake");
        setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
      }, 2000);
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

  PLAY.playedGames.push("flip");
  afterGameFinished("flip");
}

/* =========================
   Scrambled (delete last / long-press clear all)
   ========================= */
let SCR = null;

function gameScrambled() {
  const ids = PLAY.scrambledIds;
  const cards = ids.map(id => STATE.cards[id]).filter(Boolean);
  SCR = { cards, idx: 0, errors: 0, correct: 0, goldRaw: 0, lastAt: performance.now(), answer: "" };
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

  const box = document.createElement("div");
  box.className = "wordBox";
  box.innerHTML = `
    <div class="muted">بطاقة ${SCR.idx+1} من ${SCR.cards.length}</div>
    <div class="answerLine" id="scrAnswer"></div>
    <div class="lettersRow" id="scrLetters"></div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="scrOk"><span class="material-icons">check</span> موافق</button>
      <button class="btn" id="scrDel" title="حذف آخر حرف (ضغط مطوّل لمسح الكل)">
        <span class="material-icons">backspace</span> حذف
      </button>
    </div>
    <div class="tiny muted">زر حذف: ضغطة واحدة تحذف آخر حرف. ضغط مطوّل يمسح كل شيء.</div>
  `;
  area.appendChild(box);

  const ansEl = $("#scrAnswer");
  const lettersEl = $("#scrLetters");

  function syncButtons(){
    ansEl.textContent = SCR.answer;
  }

  shuffled.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "letterBtn";
    b.type = "button";
    b.textContent = ch === " " ? "␠" : ch;
    b.onclick = () => {
      SCR.answer += ch;
      syncButtons();
      b.disabled = true;
      AudioFX.beep("click");
    };
    lettersEl.appendChild(b);
  });

  // delete last, long-press clear
  let pressTimer = null;
  const delBtn = $("#scrDel");

  function clearAll(){
    SCR.answer = "";
    syncButtons();
    lettersEl.querySelectorAll("button").forEach(b => b.disabled = false);
    AudioFX.beep("click");
  }
  function deleteLast(){
    if (!SCR.answer.length) return;
    const removed = SCR.answer.slice(-1);
    SCR.answer = SCR.answer.slice(0, -1);
    // re-enable one matching disabled letter (best-effort)
    const disabled = Array.from(lettersEl.querySelectorAll("button:disabled"));
    const btn = disabled.reverse().find(x => (x.textContent === removed || (removed===" " && x.textContent==="␠")));
    if (btn) btn.disabled = false;
    syncButtons();
    AudioFX.beep("click");
  }

  delBtn.addEventListener("mousedown", ()=>{
    pressTimer = setTimeout(()=>{ clearAll(); pressTimer=null; }, 520);
  });
  delBtn.addEventListener("mouseup", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; deleteLast(); }
  });
  delBtn.addEventListener("mouseleave", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; }
  });
  // touch
  delBtn.addEventListener("touchstart", ()=>{
    pressTimer = setTimeout(()=>{ clearAll(); pressTimer=null; }, 520);
  }, {passive:true});
  delBtn.addEventListener("touchend", ()=>{
    if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; deleteLast(); }
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
      $("#gameArea").classList.add("fx-pop");
      setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
      updateHUD();
      SCR.idx++;
      renderScrambledCard();
    } else {
      SCR.errors++;
      awardOnWrong(2, 9, c.level, errorFactorFromErrors(SCR.errors));
      AudioFX.beep("bad");
      $("#gameArea").classList.add("fx-shake");
      setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
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

  PLAY.playedGames.push("scrambled");
  afterGameFinished("scrambled");
}

/* =========================
   Typing (ignore case + trim)
   ========================= */
let TYP = null;

function normalizeTyping(s){
  // تجاهل الفراغات قبل/بعد + تجاهل حالة الأحرف
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
      <div class="muted tiny">لا فرق بين أحرف كبيرة/صغيرة، ويتم تجاهل فراغات البداية/النهاية.</div>
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
      $("#gameArea").classList.add("fx-pop");
      setTimeout(()=>$("#gameArea").classList.remove("fx-pop"), 220);
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2, 10, c.level, errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      $("#gameArea").classList.add("fx-shake");
      setTimeout(()=>$("#gameArea").classList.remove("fx-shake"), 300);
      updateHUD();
      openModal("غير صحيح", "المحتوى غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
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

  PLAY.playedGames.push("typing");
  afterGameFinished("typing");
}

/* =========================
   Help log + effects
   ========================= */
function logHelp(game, text){
  if (!PLAY?.helpLogs?.[game]) return;
  PLAY.helpLogs[game].push({ at: Date.now(), text });
}
function showHelpLog(game){
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
  openModal("سجل المساعدات", html, [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
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
      el.textContent = "✦";
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
  const typed = input.value.trim();
  const next = c.foreign.charAt(typed.length);
  logHelp("typing", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

/* =========================
   After game finished (FIX: hide next button after 4 games, even in modal)
   ========================= */
function afterGameFinished(gameKey) {
  const done4 = ["matching","flip","scrambled","typing"].every(g => PLAY.playedGames.includes(g));
  if (done4) $("#btnNextGame").style.display = "none";

  const buttons = [];

  if (!done4){
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
      <div class="muted" style="margin-top:8px">يمكنك الانتقال للتقييم. ${done4 ? "هذه كانت آخر لعبة قبل التلميح." : ""}</div>
    </div>
  `, buttons);
}

/* =========================
   Hint (no stats)
   ========================= */
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

async function rateHint(cardId, evalText) {
  const c = STATE.cards[cardId];
  if (!c) return;

  if (evalText === "صعب") c.level = 0;
  else if (evalText === "متوسط") c.level = (c.level <= 3) ? 0 : 2;

  c.lastHintEval = evalText;
  c.lastHintEvalAt = Date.now();

  PLAY.hintIndex++;
  AudioFX.beep("ok");
  await saveCloudState();
  renderHintCard();
}

async function finishHintAll() {
  PLAY.completedHintAll = true;

  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  const today = safeTodayKey();
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;
  await saveCloudState();

  AudioFX.beep("win");
  AudioFX.beep("rank");

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

/* =========================
   Abort lesson
   ========================= */
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
async function handleAbortLesson() {
  if (PLAY && !PLAY.completedHintAll) {
    cancelLesson();
    STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
    await saveCloudState();
  }
  endPlay(true);
}

/* =========================
   Store
   ========================= */
async function buyExtraCard() {
  if (STATE.inventory.extraCardsBought >= 2) {
    AudioFX.beep("bad");
    openModal("تنبيه","وصلت للحد اليومي لشراء البطاقات الإضافية (2).",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  if (STATE.wallet.gold < 100) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 100 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 100;
  STATE.inventory.extraCardsBought += 1;
  STATE.meta.lastActivity = "تم شراء بطاقة إضافية لليوم.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buySkip() {
  if (STATE.wallet.gold < 900) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 900 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 900;
  STATE.inventory.skip += 1;
  STATE.meta.lastActivity = "تم شراء تخطي.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buyHelp() {
  if (STATE.wallet.gold < 150) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 150 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 150;
  STATE.inventory.help += 1;
  STATE.meta.lastActivity = "تم شراء مساعدة.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}
async function buyFuel() {
  if (STATE.wallet.gold < 250) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 250 ذهب.",[ makeBtn("إغلاق","btn btn--primary",closeModal) ]);
    return;
  }
  STATE.wallet.gold -= 250;
  STATE.inventory.fuel = (STATE.inventory.fuel || 0) + 1;
  STATE.meta.lastActivity = "تم شراء وقود.";
  await saveCloudState();
  AudioFX.beep("coin");
  refreshHUD();
}

/* =========================
   Start play
   ========================= */
function handleStartPlay() {
  const cards = buildLessonCards();
  if (cards.length === 0) {
    AudioFX.beep("bad");
    openModal("تنبيه", "لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا", [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }

  const opened = checkOverdueModal();
  if (opened){
    pendingStartLesson = true;
    return;
  }
  startLesson();
}

/* =========================
   Export/Import (cloud saved)
   ========================= */
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

async function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const obj = JSON.parse(reader.result);
      if (!obj.wallet || !obj.cards || !obj.groups) throw new Error("invalid");
      STATE = obj;
      STATE.meta.lastActivity = "تم استيراد نسخة احتياطية.";
      await saveCloudState();
      refreshAll();
      AudioFX.beep("ok");
      openModal("تم", "تم الاستيراد بنجاح.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    }catch{
      AudioFX.beep("bad");
      openModal("خطأ", "ملف غير صالح.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    }
  };
  reader.readAsText(file);
}

/* =========================
   Before unload rules
   ========================= */
function enforceBeforeUnload() {
  window.addEventListener("beforeunload", async () => {
    // إذا خرج قبل 4 بطاقات: امسح إضافة اليوم (حسب شرطك)
    if (STATE && addLockActiveToday()) {
      const key = getTodayGroupKey();
      const g = STATE.groups[key];
      if (g) {
        g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
        g.cardIds = [];
      }
      STATE.meta.addLockDateKey = null;
      STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة بسبب الخروج قبل 4 بطاقات.";
      await saveCloudState();
    }
    // إذا خرج أثناء الدرس قبل التلميح: إلغاء المكافآت
    if (PLAY && !PLAY.completedHintAll) {
      cancelLesson();
      STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
      await saveCloudState();
    }
  });
}

/* =========================
   Account menu: logout + delete
   ========================= */
async function showAccountMenu(){
  openModal("الحساب", `
    <div class="modalRow">
      <div class="muted">يمكنك تسجيل الخروج أو حذف الحساب نهائيًا.</div>
      <div class="divider"></div>
      <div class="muted tiny">حذف الحساب سيحذف كل بياناتك نهائيًا.</div>
      <div style="margin-top:10px">
        <button class="btn btn--primary" id="mLogout"><span class="material-icons">logout</span> تسجيل الخروج</button>
        <button class="btn btn--ghost" id="mDelete" style="opacity:.65;font-weight:800">حذف الحساب</button>
      </div>
    </div>
  `, [], {closable:true});

  $("#mLogout").onclick = async ()=>{
    await signOut(auth);
    location.replace("login.html");
  };

  $("#mDelete").onclick = ()=>{
    closeModal();
    confirmDeleteAccountStep1();
  };
}

function confirmDeleteAccountStep1(){
  openModal("تأكيد", `
    <div class="modalRow">
      <div style="font-weight:900">هل تريد حذف حسابك؟</div>
      <div class="muted" style="margin-top:6px">هذا الإجراء خطير.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("متابعة","btn btn--danger", ()=>{ closeModal(); confirmDeleteAccountStep2(); })
  ], {closable:false});
}
function confirmDeleteAccountStep2(){
  openModal("تأكيد نهائي", `
    <div class="modalRow">
      <div style="font-weight:900">ستفقد جميع بياناتك نهائيًا.</div>
      <div class="muted" style="margin-top:6px">لا يمكن الاسترجاع بعد الحذف.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("حذف نهائي","btn btn--danger", ()=>{ closeModal(); deleteAccountNow(); })
  ], {closable:false});
}

async function deleteAccountNow(){
  const u = auth.currentUser;
  if (!u) { location.replace("login.html"); return; }

  try{
    // حذف بيانات اللعبة (Doc واحد) + user profile doc
    await deleteDoc(stateDocRef(u.uid));
    await deleteDoc(userDocRef(u.uid));

    // delete user may require recent login
    await deleteUser(u);

    location.replace("signup.html");
  }catch(e){
    const msg = String(e?.message || "");

    // requires recent login
    if (msg.includes("requires-recent-login")){
      await reauthAndDelete();
      return;
    }

    openModal("فشل الحذف", msg || "حدث خطأ.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
  }
}

async function reauthAndDelete(){
  const u = auth.currentUser;
  if (!u) return;

  const providerId = u.providerData?.[0]?.providerId || "";

  try{
    if (providerId === "google.com"){
      await reauthenticateWithPopup(u, new GoogleAuthProvider());
    } else {
      // password: ask for password
      openModal("تأكيد كلمة المرور", `
        <div class="modalRow">
          <div class="muted">أدخل كلمة المرور لإتمام حذف الحساب:</div>
          <div class="divider"></div>
          <input id="reauthPass" type="password" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background: rgba(0,0,0,.22);color: var(--txt);outline:none;" />
          <div class="rowActions" style="margin-top:12px">
            <button class="btn" id="reauthCancel">إلغاء</button>
            <button class="btn btn--danger" id="reauthOk">متابعة الحذف</button>
          </div>
        </div>
      `, [], {closable:false});

      $("#reauthCancel").onclick = closeModal;
      $("#reauthOk").onclick = async ()=>{
        const p = $("#reauthPass").value;
        if (!p) return;
        try{
          const cred = EmailAuthProvider.credential(u.email, p);
          await reauthenticateWithCredential(u, cred);
          closeModal();
        }catch(err){
          openModal("فشل", err?.message || "كلمة المرور غير صحيحة.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
          return;
        }
      };

      // wait a bit for user to complete modal; we rely on next attempt
      return;
    }

    // بعد إعادة التوثيق
    await deleteDoc(stateDocRef(u.uid));
    await deleteDoc(userDocRef(u.uid));
    await deleteUser(u);
    location.replace("signup.html");
  }catch(e){
    openModal("فشل", e?.message || "لم يتم إعادة التوثيق.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
  }
}

/* =========================
   Wire UI
   ========================= */
let wired = false;
function wireUI() {
  if (wired) return;
  wired = true;

  // User pill
  $("#userPill").onclick = ()=>{ AudioFX.beep("click"); showAccountMenu(); };

  // Nav
  $$(".nav__btn").forEach(b => {
    b.onclick = () => {
      AudioFX.beep("click");
      showView(b.dataset.view);
    };
  });

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
}

/* =========================
   Refresh all
   ========================= */
function refreshAll() {
  if (!STATE) return;
  ensureDayRollover();
  getOrCreateTodayGroup();
  refreshHUD();
  refreshTodayList();
  refreshCardsList($("#cardsSearch")?.value || "");
}
