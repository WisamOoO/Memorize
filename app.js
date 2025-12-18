/* app.js (Firebase + Firestore + AppCheck + Auth Gate) */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  deleteUser,
  reload
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

/* ---------- DOM helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Firebase config (yours) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyCK1j_ILN12Vok3N6it1dgYNphqJVP0axw",
  authDomain: "memorize-game-bb7e8.firebaseapp.com",
  projectId: "memorize-game-bb7e8",
  storageBucket: "memorize-game-bb7e8.firebasestorage.app",
  messagingSenderId: "16321377204",
  appId: "1:16321377204:web:9645129d023710f6b5f8e1",
  measurementId: "G-CK46BP6YJ3"
};

const APP_CHECK_SITE_KEY = "6LfC6i8sAAAAAFze6mVK6Ve3erMC3ccdIa8sWsSf";

/* ---------- Firebase init ---------- */
const APP = initializeApp(firebaseConfig);
initializeAppCheck(APP, {
  provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});

const AUTH = getAuth(APP);
const DB = getFirestore(APP);

/* ---------- Audio ---------- */
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
  return {beep};
})();

/* ---------- Visual effects ---------- */
function fx(el, cls){
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(()=> el.classList.remove(cls), 450);
}

/* ---------- Modal ---------- */
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
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

/* ---------- Cloud State ---------- */
let USER = null;
let STATE = null;
let STATE_REF = null;

let SAVE_TMR = null;
let SAVE_PENDING = false;

function scheduleSave(reason="") {
  if (!USER || !STATE || !STATE_REF) return;
  SAVE_PENDING = true;
  if (SAVE_TMR) clearTimeout(SAVE_TMR);
  SAVE_TMR = setTimeout(async () => {
    try{
      await setDoc(STATE_REF, STATE, { merge: true });
      SAVE_PENDING = false;
    }catch(e){
      // صامت: لأن Firestore قد يفشل مؤقتاً (شبكة)
      console.warn("save failed", e?.code || e);
    }
  }, 450);
}

async function loadStateFromCloud(uid){
  STATE_REF = doc(DB, "users", uid, "app", "state");
  const snap = await getDoc(STATE_REF);
  if (snap.exists()) return snap.data();
  const s = defaultState();
  await setDoc(STATE_REF, s, { merge: false });
  return s;
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

/* ---------- Defaults ---------- */
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

/* ---------- Auth Gate UI ---------- */
function showAuthGate(){
  $("#view-auth").classList.add("active");
  $("#hudBar").style.display = "none";
  $("#navBar").style.display = "none";
  $("#mainViews").style.display = "none";
}
function showMainApp(){
  $("#view-auth").classList.remove("active");
  $("#hudBar").style.display = "";
  $("#navBar").style.display = "";
  $("#mainViews").style.display = "";
}

/* ---------- Password strength ---------- */
function isSequentialDigits(s){
  const digits = s.replace(/\D/g,"");
  if (digits.length < 4) return false;
  for (let i=0;i<=digits.length-4;i++){
    const chunk = digits.slice(i,i+4);
    let asc = true;
    for (let k=1;k<chunk.length;k++){
      if (Number(chunk[k]) !== Number(chunk[k-1])+1) { asc = false; break; }
    }
    if (asc) return true;
  }
  return false;
}
function tooMuchRepeat(s){
  // 4 نفس الحرف وراء بعض
  return /(.)\1\1\1/.test(s);
}
function validatePassword(pw){
  if (!pw || pw.length < 8) return "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
  if (isSequentialDigits(pw)) return "تجنب التسلسلات الرقمية مثل 1234.";
  if (tooMuchRepeat(pw)) return "تجنب تكرار نفس الحرف كثيرًا.";
  return null;
}

/* ---------- Normalize for typing ---------- */
function normText(s){
  return String(s ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();
}

/* ---------- State helpers ---------- */
function safeTodayKey() {
  const real = nowISODateKey();
  if (!STATE.meta.lastSeenDateKey) {
    STATE.meta.lastSeenDateKey = real;
    return real;
  }
  if (real < STATE.meta.lastSeenDateKey) {
    return STATE.meta.lastSeenDateKey;
  }
  STATE.meta.lastSeenDateKey = real;
  return real;
}
function uuid() {
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}
function getTodayGroupKey() {
  return safeTodayKey();
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

/* ---------- Day rollover ---------- */
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

  scheduleSave("day rollover");
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

  $("#userNameLabel").textContent = USER?.displayName || "حساب";

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

  $("#addHint").textContent = `بطاقات اليوم: ${todayCount()} / ${todayCapacity()} | أول إضافة: لا خروج قبل ${MIN_DAILY_FIRST} أو حذف وخروج.`;
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
          scheduleSave("ignore toggle");
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
  $(`#view-${name}`).classList.add("active");

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
  hintHelp: "أدخل تلميحًا يساعد التذكر (رمز/إيموجي/وصف). الحقل إلزامي. حد 60 حرف."
};

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
  scheduleSave("delete today add");
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
    scheduleSave("add lock");
  }
}
function saveNewCard() {
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
  scheduleSave("add card");

  clearAddInputs();
  AudioFX.beep("ok");
  refreshHUD();
  refreshTodayList();
}

/* ---------- Overdue modal (mandatory) ---------- */
function checkOverdueModal() {
  const today = safeTodayKey();
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
    scheduleSave("resolve overdue");
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
    typing: "اكتب النص الأصلي عند رؤية الترجمة. لا يفرق بين كبير/صغير ويتجاهل الفراغات قبل/بعد.",
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
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        scheduleSave("use skip");
        afterGameFinished(gameKey);
      })
    ]);
  };

  $("#btnUseHelp").onclick = () => {
    if (gameKey === "hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    scheduleSave("use help");

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
    fx(first.el, "fx-pop");
    fx(el, "fx-pop");
    MATCH.correct++;

    awardOnCorrect(12, 6, dt, Math.max(first.level, t.level));
    const F = speedFactor(dt);
    const L = levelMultiplier(Math.max(first.level, t.level));
    MATCH.goldRaw += (3 * F * L);

    AudioFX.beep("ok");

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    awardOnWrong(2, 8, Math.max(first.level, t.level), errorFactorFromErrors(MATCH.errors));
    fx(first.el, "fx-shake");
    fx(el, "fx-shake");
    AudioFX.beep("bad");
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
  fx(el, "fx-pop");
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
        updateHUD();

        if (FLIP.pairs >= PLAY.cards.length) finishFlip();
      }, 180);
    } else {
      setTimeout(() => {
        a.el.classList.add("back"); a.el.textContent = "✦";
        b.el.classList.add("back"); b.el.textContent = "✦";
        fx(a.el, "fx-shake");
        fx(b.el, "fx-shake");
        FLIP.open = [];
        FLIP.locked = false;
        AudioFX.beep("bad");
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

/* ---------- Scrambled ---------- */
let SCR = null;

function gameScrambled() {
  const ids = PLAY.scrambledIds;
  const cards = ids.map(id => STATE.cards[id]).filter(Boolean);
  SCR = { cards, idx: 0, errors: 0, correct: 0, goldRaw: 0, lastAt: performance.now(), answer: "", stack: [] };
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
    <div class="muted tiny">ضغطة: حذف آخر حرف — ضغطة مطوّلة: حذف الكل</div>
  `;
  area.appendChild(box);

  const ansEl = $("#scrAnswer");
  const lettersEl = $("#scrLetters");

  shuffled.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "letterBtn";
    b.type = "button";
    b.textContent = ch === " " ? "␠" : ch;
    b.onclick = () => {
      SCR.answer += ch;
      SCR.stack.push({ ch, btn: b });
      ansEl.textContent = SCR.answer;
      b.disabled = true;
      AudioFX.beep("click");
      fx(ansEl, "fx-pop");
    };
    lettersEl.appendChild(b);
  });

  // delete last vs long press clear all
  let pressT = null;
  const clearBtn = $("#scrClear");

  function deleteLast(){
    if (!SCR.stack.length) return;
    const last = SCR.stack.pop();
    if (last?.btn) last.btn.disabled = false;
    SCR.answer = SCR.answer.slice(0, -1);
    ansEl.textContent = SCR.answer;
    AudioFX.beep("click");
    fx(ansEl, "fx-pop");
  }
  function clearAll(){
    SCR.stack.forEach(x => { if (x?.btn) x.btn.disabled = false; });
    SCR.stack = [];
    SCR.answer = "";
    ansEl.textContent = "";
    AudioFX.beep("click");
    fx(ansEl, "fx-glow");
  }

  clearBtn.addEventListener("pointerdown", () => {
    pressT = setTimeout(() => {
      pressT = null;
      clearAll();
    }, 520);
  });
  clearBtn.addEventListener("pointerup", () => {
    if (pressT) {
      clearTimeout(pressT);
      pressT = null;
      deleteLast();
    }
  });
  clearBtn.addEventListener("pointerleave", () => {
    if (pressT) { clearTimeout(pressT); pressT = null; }
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
      updateHUD();
      SCR.idx++;
      renderScrambledCard();
    } else {
      SCR.errors++;
      awardOnWrong(2, 9, c.level, errorFactorFromErrors(SCR.errors));
      AudioFX.beep("bad");
      fx($("#scrAnswer"), "fx-shake");
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

/* ---------- Typing ---------- */
let TYP = null;

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
      <div class="muted tiny">لا يفرق بين كبير/صغير ويتجاهل الفراغات قبل/بعد.</div>
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

    const v = normText(input.value);
    const target = normText(c.foreign);

    if (v === target) {
      TYP.correct++;
      awardOnCorrect(16, 8, dt, c.level);
      const F = speedFactor(dt);
      const L = levelMultiplier(c.level);
      TYP.goldRaw += (5 * F * L);

      AudioFX.beep("ok");
      fx(input, "fx-glow");
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2, 10, c.level, errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      fx(input, "fx-shake");
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
  const typed = input.value;
  const next = c.foreign.charAt(typed.length);
  logHelp("typing", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

/* ---------- After game finished ---------- */
function afterGameFinished(gameKey) {
  const done4 = ["matching","flip","scrambled","typing"].every(g => PLAY.playedGames.includes(g));
  if (done4) $("#btnNextGame").style.display = "none";

  openModal("تم إنهاء اللعبة", `
    <div class="modalRow">
      <div class="muted">اللعبة: <b>${escapeHTML(gameTitle(gameKey))}</b></div>
      <div class="muted" style="margin-top:8px">اختر اللعبة التالية أو انتقل إلى تقييم البطاقات.</div>
    </div>
  `, [
    makeBtn(`<span class="material-icons">sports_esports</span> اللعبة التالية`, "btn btn--primary", () => {
      closeModal();
      if (!done4) launchNextGame();
    }),
    makeBtn(`<span class="material-icons">task_alt</span> تقييم البطاقات`, "btn btn--primary", () => {
      closeModal();
      goToHint();
    })
  ]);
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
  scheduleSave("hint eval");
  renderHintCard();
}

function finishHintAll() {
  PLAY.completedHintAll = true;

  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  const today = safeTodayKey();
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;
  scheduleSave("finish hint");

  AudioFX.beep("coin");
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
    scheduleSave("abort lesson");
  }
  endPlay(true);
}

/* ---------- Store ---------- */
function buyExtraCard() {
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
  scheduleSave("buy extra");
  AudioFX.beep("coin");
  refreshHUD();
}
function buySkip() {
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
  scheduleSave("buy skip");
  AudioFX.beep("coin");
  refreshHUD();
}
function buyHelp() {
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
  scheduleSave("buy help");
  AudioFX.beep("coin");
  refreshHUD();
}
function buyFuel() {
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
  scheduleSave("buy fuel");
  AudioFX.beep("coin");
  refreshHUD();
}

/* ---------- Start play ---------- */
function handleStartPlay() {
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
      STATE.meta.lastActivity = "تم استيراد نسخة احتياطية.";
      scheduleSave("import json");
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

/* ---------- Account menu (logout/delete) ---------- */
function openAccountMenu(){
  openModal("الحساب", `
    <div class="modalRow">
      <div style="font-weight:900">${escapeHTML(USER?.displayName || "حساب")}</div>
      <div class="muted" style="margin-top:6px">${escapeHTML(USER?.email || "")}</div>
      <div class="divider"></div>
      <div class="muted">تسجيل الخروج سيُبقي بياناتك محفوظة على السيرفر.</div>
      <div class="muted tiny">زر حذف الحساب موجود بالأسفل.</div>
    </div>
  `, [
    makeBtn(`<span class="material-icons">logout</span> تسجيل الخروج`, "btn btn--primary", async ()=>{
      closeModal();
      await signOut(AUTH);
    }),
    makeBtn(`حذف الحساب`, "btn btn--ghost", ()=>{
      closeModal();
      confirmDeleteAccount1();
    }),
    makeBtn(`إغلاق`, "btn", closeModal)
  ]);
}

function confirmDeleteAccount1(){
  openModal("تأكيد", `
    <div class="modalRow">
      <div style="font-weight:900">هل تريد حذف حسابك؟</div>
      <div class="muted" style="margin-top:6px">هذا الإجراء لا يمكن التراجع عنه.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("متابعة","btn btn--danger", ()=>{
      closeModal();
      confirmDeleteAccount2();
    })
  ], {closable:false});
}
function confirmDeleteAccount2(){
  openModal("تأكيد نهائي", `
    <div class="modalRow">
      <div style="font-weight:900">ستفقد جميع بياناتك نهائيًا.</div>
      <div class="muted" style="margin-top:6px">سيتم حذف التقدم والبطاقات من السيرفر بالكامل.</div>
    </div>
  `, [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("حذف نهائي","btn btn--danger", async ()=>{
      try{
        // delete cloud data first
        if (STATE_REF) await deleteDoc(STATE_REF);
        // delete auth user
        await deleteUser(AUTH.currentUser);
        closeModal();
      }catch(e){
        closeModal();
        const code = e?.code || "";
        let msg = "فشل حذف الحساب.";
        if (code.includes("requires-recent-login")) {
          msg = "لا يمكن حذف الحساب الآن. سجّل خروج ثم سجّل دخول من جديد، وبعدها حاول حذف الحساب.";
        }
        openModal("خطأ", msg, [makeBtn("إغلاق","btn btn--primary", closeModal)]);
      }
    })
  ], {closable:false});
}

/* ---------- AUTH actions ---------- */
function setAuthMsg(id, text){
  const el = $(id);
  if (el) el.textContent = text;
}

async function doLogin(){
  try{
    setAuthMsg("#loginMsg", "جاري تسجيل الدخول...");
    const email = $("#loginEmail").value.trim();
    const pw = $("#loginPass").value;
    await signInWithEmailAndPassword(AUTH, email, pw);
    AudioFX.beep("ok");
  }catch(e){
    const code = e?.code || "";
    setAuthMsg("#loginMsg", `فشل تسجيل الدخول: ${code}`);
    AudioFX.beep("bad");
  }
}

async function doRegister(){
  const name = $("#regName").value.trim();
  const email = $("#regEmail").value.trim();
  const pw1 = $("#regPass").value;
  const pw2 = $("#regPass2").value;

  if (!name) { setAuthMsg("#regMsg","الاسم إلزامي."); AudioFX.beep("bad"); return; }
  if (!email) { setAuthMsg("#regMsg","الإيميل إلزامي."); AudioFX.beep("bad"); return; }
  if (pw1 !== pw2) { setAuthMsg("#regMsg","كلمتا المرور غير متطابقتين."); AudioFX.beep("bad"); return; }

  const pwErr = validatePassword(pw1);
  if (pwErr) { setAuthMsg("#regMsg", pwErr); AudioFX.beep("bad"); return; }

  try{
    setAuthMsg("#regMsg", "جاري إنشاء الحساب...");
    const cred = await createUserWithEmailAndPassword(AUTH, email, pw1);
    await updateProfile(cred.user, { displayName: name });
    await sendEmailVerification(cred.user);

    setAuthMsg("#regMsg", "تم إنشاء الحساب. تم إرسال رسالة تفعيل إلى بريدك. فعّل الحساب ثم سجّل دخول.");
    AudioFX.beep("ok");

    // منع الاستخدام قبل التفعيل: نخرج المستخدم فوراً
    await signOut(AUTH);
  }catch(e){
    const code = e?.code || "";
    setAuthMsg("#regMsg", `فشل إنشاء الحساب: ${code}`);
    AudioFX.beep("bad");
  }
}

async function doGoogle(){
  try{
    setAuthMsg("#loginMsg", "جاري فتح Google...");
    const prov = new GoogleAuthProvider();
    await signInWithPopup(AUTH, prov);
    AudioFX.beep("ok");
  }catch(e){
    const code = e?.code || "";
    setAuthMsg("#loginMsg", `فشل Google: ${code}`);
    AudioFX.beep("bad");
  }
}

async function doForgot(){
  const email = $("#loginEmail").value.trim();
  if (!email) {
    openModal("تنبيه","اكتب بريدك الإلكتروني أولاً ثم اضغط نسيت كلمة المرور.",[
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }
  try{
    await sendPasswordResetEmail(AUTH, email);
    openModal("تم","تم إرسال رابط تغيير كلمة المرور إلى بريدك.",[
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    AudioFX.beep("ok");
  }catch(e){
    openModal("خطأ", `فشل الإرسال: ${escapeHTML(e?.code || "")}`, [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    AudioFX.beep("bad");
  }
}

async function promptNameIfMissing(user){
  if (user?.displayName && user.displayName.trim()) return true;

  return new Promise((resolve) => {
    openModal("أدخل اسمك", `
      <div class="modalRow">
        <div class="muted">لازم تكتب اسم حتى يظهر في التطبيق.</div>
        <div class="divider"></div>
        <div class="field">
          <label>الاسم</label>
          <input id="namePromptIn" maxlength="24" placeholder="اكتب اسمك" />
          <div class="field__sub">يمكن تغييره لاحقًا بحذف الحساب فقط (حالياً).</div>
        </div>
      </div>
    `, [
      makeBtn("حفظ","btn btn--primary", async ()=>{
        const nm = ($("#namePromptIn")?.value || "").trim();
        if (!nm) { AudioFX.beep("bad"); return; }
        try{
          await updateProfile(user, { displayName: nm });
          closeModal();
          resolve(true);
        }catch(e){
          AudioFX.beep("bad");
        }
      })
    ], {closable:false});
  });
}

/* ---------- Wire UI ---------- */
function wireUI() {
  // Auth tabs
  $$(".authTab").forEach(t => {
    t.onclick = () => {
      AudioFX.beep("click");
      $$(".authTab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const k = t.getAttribute("data-auth-tab");
      $$(".authBox").forEach(b => b.classList.remove("active"));
      $(`#auth-${k}`).classList.add("active");
    };
  });

  // Auth buttons
  $("#btnLogin").onclick = () => { AudioFX.beep("click"); doLogin(); };
  $("#btnRegister").onclick = () => { AudioFX.beep("click"); doRegister(); };
  $("#btnGoogle").onclick = () => { AudioFX.beep("click"); doGoogle(); };
  $("#btnForgot").onclick = () => { AudioFX.beep("click"); doForgot(); };

  $("#btnResendVerify").onclick = async () => {
    try{
      const u = AUTH.currentUser;
      if (!u) return;
      await sendEmailVerification(u);
      $("#verifyMsg").textContent = "تمت إعادة إرسال رسالة التفعيل.";
      AudioFX.beep("ok");
    }catch(e){
      $("#verifyMsg").textContent = `فشل الإرسال: ${e?.code || ""}`;
      AudioFX.beep("bad");
    }
  };
  $("#btnLogoutFromVerify").onclick = async () => {
    await signOut(AUTH);
  };

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

  // Account pill
  $("#userPill").onclick = () => { AudioFX.beep("click"); openAccountMenu(); };
}

/* ---------- Refresh all ---------- */
function refreshAll() {
  ensureDayRollover();
  getOrCreateTodayGroup();
  refreshHUD();
  refreshTodayList();
  refreshCardsList($("#cardsSearch")?.value || "");
}

/* ---------- Auth state gate ---------- */
async function handleSignedIn(u){
  USER = u;

  // enforce verification (email/password)
  await reload(u);
  if (!u.emailVerified && (u.providerData || []).some(p => p.providerId === "password")) {
    showAuthGate();
    $("#verifyBox").style.display = "";
    $("#verifyMsg").textContent = "—";
    $("#loginMsg").textContent = "سجّل الدخول بعد التفعيل.";
    return;
  }

  $("#verifyBox").style.display = "none";

  // if Google without displayName -> ask
  const okName = await promptNameIfMissing(u);
  if (!okName) return;

  // load cloud state
  STATE = await loadStateFromCloud(u.uid);

  // ensure structures exist
  if (!STATE.meta || !STATE.wallet || !STATE.rank || !STATE.inventory) {
    STATE = defaultState();
    await setDoc(doc(DB, "users", u.uid, "app", "state"), STATE, { merge:false });
  }

  showMainApp();
  refreshAll();
  checkOverdueModal();
}

function handleSignedOut(){
  USER = null;
  STATE = null;
  STATE_REF = null;
  showAuthGate();
}

/* ---------- Init ---------- */
(function init() {
  wireUI();
  showAuthGate();

  onAuthStateChanged(AUTH, async (u) => {
    if (!u) return handleSignedOut();
    try{
      await handleSignedIn(u);
    }catch(e){
      console.warn("auth init failed", e?.code || e);
      showAuthGate();
      setAuthMsg("#loginMsg", "فشل تحميل البيانات. حاول لاحقاً.");
    }
  });

  // basic unload rule: if exit during lesson before hint => cancel rewards
  window.addEventListener("beforeunload", () => {
    if (STATE && addLockActiveToday()) {
      const key = getTodayGroupKey();
      const g = STATE.groups[key];
      if (g) {
        g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
        g.cardIds = [];
      }
      STATE.meta.addLockDateKey = null;
      STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة بسبب الخروج قبل 4 بطاقات.";
      // لا يمكن ضمان حفظ متزامن قبل الإغلاق، لكن نحاول
      scheduleSave("unload add lock");
    }
    if (PLAY && !PLAY.completedHintAll) {
      cancelLesson();
      if (STATE) {
        STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
        scheduleSave("unload abort lesson");
      }
    }
  });
})();
