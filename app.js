/* =========================
   Memorize Web App (No DB)
   Persistent storage: localStorage
   ========================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Storage ---------- */
const STORAGE_KEY = "memorize_app_v2";

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

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultState() {
  const dateKey = nowISODateKey();
  return {
    meta: {
      createdAt: Date.now(),
      lastSeenDateKey: dateKey,
      lastAttendanceDateKey: null,
      streak: 0,
      lastActivity: "لا يوجد.",
      // إضافة اليوم: قفل الخروج قبل 4 بطاقات
      addLockDateKey: null
    },
    wallet: {
      gold: 900,
      xp: 0,
    },
    rank: {
      tierIndex: 0,
      subLevel: 1,
      progress: 0,
    },
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

/* ---------- Account Level (XP -> Level) ---------- */
function accountLevelFromXP(xp){
  // منحنى غير حاد: المستوى يرتفع تدريجيًا
  // Lv1 عند 0 XP
  const lvl = Math.floor(Math.sqrt(Math.max(0, xp) / 500)) + 1;
  const curMinXP = (Math.max(0, (lvl-1)) ** 2) * 500;
  const nextMinXP = (lvl ** 2) * 500;
  return { level: lvl, curMinXP, nextMinXP, toNext: Math.max(0, nextMinXP - xp) };
}

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

/* ---------- Modal ---------- */
function openModal(title, bodyHTML, footButtons = [], opts = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = bodyHTML;

  const foot = $("#modalFoot");
  foot.innerHTML = "";
  footButtons.forEach(btn => foot.appendChild(btn));

  const modal = $("#modal");
  modal.classList.remove("hidden");

  const closeBtn = $("#modalClose");
  const closable = opts.closable !== false;
  closeBtn.style.display = closable ? "" : "none";

  if (closable) {
    closeBtn.onclick = () => closeModal();
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } else {
    closeBtn.onclick = null;
    modal.onclick = null;
  }
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

function makeBtn(text, cls="btn", onClick=()=>{}) {
  const b = document.createElement("button");
  b.className = cls;
  b.type = "button";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

/* ---------- State ---------- */
let STATE = loadState() || defaultState();

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
    STATE.groups[key] = {
      id: key,
      name: formatGroupName(key),
      dateKey: key,
      cardIds: [],
    };
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

/* ---------- Card daily progression (attendance-driven) ---------- */
function bumpCardLevelsForNewDay(prevDayKey, todayKey){
  // فقط إذا كان الأمس فيه حضور
  if (STATE.meta.lastAttendanceDateKey !== prevDayKey) return;

  Object.values(STATE.cards).forEach(c => {
    if (!c) return;

    // ترقية حتى 6 فقط
    if (c.level < 6) c.level += 1;

    // مستوى 7 بعد 30 يوم من الإضافة (حسب التاريخ)
    const addKey = c.addDateKey || prevDayKey;
    const age = daysBetween(addKey, todayKey);
    if (age >= 30) c.level = 7;
  });
}

/* ---------- Add lock (no exit before 4) ---------- */
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
  // إذا بدأ يكتب أو حفظ أي شيء: قفل اليوم
  STATE.meta.addLockDateKey = today;
}
function clearAddInputs(){
  $("#inForeign").value = "";
  $("#inNative").value = "";
  $("#inHint").value = "";
}

/* ---------- Ensure day rollover (refund + streak + fuel + level bumps) ---------- */
function ensureDayRollover() {
  const today = safeTodayKey(STATE);
  const prev = STATE.inventory.dateKey;

  if (today !== prev) {
    // حماية الحماسة: إذا الأمس ما فيه حضور، استهلك وقود أو صفّر
    if (STATE.meta.lastAttendanceDateKey !== prev) {
      if ((STATE.inventory.fuel || 0) > 0) {
        STATE.inventory.fuel -= 1;
        STATE.meta.lastActivity = "تم استخدام 1 وقود لحماية الحماسة من الانطفاء.";
        AudioFX.beep("coin");
      } else {
        STATE.meta.streak = 0;
      }
    }

    // ترقية مستويات البطاقات (فقط إذا كان الأمس حضور)
    bumpCardLevelsForNewDay(prev, today);

    // ترقية تلقائية لمستوى 7 إذا تعدى 30 يوم (حتى لو ما صار bump)
    Object.values(STATE.cards).forEach(c => {
      const addKey = c?.addDateKey;
      if (!addKey) return;
      const age = daysBetween(addKey, today);
      if (age >= 30) c.level = 7;
    });

    // refund 50% for unused extra cards
    const unused = Math.max(0, STATE.inventory.extraCardsBought - STATE.inventory.extraCardsUsed);
    if (unused > 0) {
      const refund = Math.floor(unused * 100 * 0.5);
      STATE.wallet.gold += refund;
      STATE.meta.lastActivity = `تمت إعادة ${refund} ذهب (50% من بطاقات إضافية غير مستخدمة).`;
      AudioFX.beep("coin");
    }

    // reset daily-only counters
    STATE.inventory.dateKey = today;
    STATE.inventory.extraCardsBought = 0;
    STATE.inventory.extraCardsUsed = 0;

    // قفل الإضافة لا ينتقل لليوم التالي
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

/* ---------- UI ---------- */
function refreshTopbar() {
  $("#goldVal").textContent = STATE.wallet.gold;
  $("#xpVal").textContent = STATE.wallet.xp;

  const acc = accountLevelFromXP(STATE.wallet.xp);
  $("#accLevelVal").textContent = `Lv ${acc.level}`;

  $("#rankVal").textContent = `${TIERS[STATE.rank.tierIndex]} ${STATE.rank.subLevel}`;
  $("#streakVal").textContent = STATE.meta.streak;

  $("#homeLevelLine").textContent = `المستوى: ${acc.level} (للمستوى التالي: ${acc.toNext} XP)`;
  $("#homeXpLine").textContent = `XP: ${STATE.wallet.xp}`;

  const due = dueCardsToday().length;
  const groups = dueGroupsToday().length;
  $("#todaySummary").innerHTML = `
    البطاقات المستحقة اليوم: <b>${due}</b><br/>
    مجموعات يومية مستحقة: <b>${groups}</b><br/>
    السعة اليوم: <b>${todayCapacity()}</b>
  `;
  $("#lastActivity").innerHTML = STATE.meta.lastActivity || "لا يوجد.";
}

function refreshStoreInv() {
  $("#invExtra").textContent = Math.max(0, STATE.inventory.extraCardsBought - STATE.inventory.extraCardsUsed);
  $("#invSkip").textContent = STATE.inventory.skip;
  $("#invHelp").textContent = STATE.inventory.help;
  $("#invFuel").textContent = STATE.inventory.fuel || 0;
}

function refreshAddView() {
  const cap = todayCapacity();
  const cnt = todayCount();
  $("#todayCap").textContent = cap;
  $("#todayCount").textContent = cnt;

  const g = getOrCreateTodayGroup();
  const list = $("#todayList");
  list.innerHTML = "";

  g.cardIds.slice().reverse().forEach(id => {
    const c = STATE.cards[id];
    if (!c) return;
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="cardTop">
        <div>
          <div class="cardTitle">${escapeHTML(c.foreign)}</div>
          <div class="cardSub">${escapeHTML(c.native)}</div>
        </div>
        <div class="badge">مستوى ${c.level}</div>
      </div>
    `;
    el.onclick = () => {
      openModal("تلميح البطاقة", `
        <div class="bigText">${escapeHTML(c.hint)}</div>
        <div class="divider"></div>
        <div class="muted">النص: <b>${escapeHTML(c.foreign)}</b></div>
        <div class="muted">الترجمة: <b>${escapeHTML(c.native)}</b></div>
      `, [makeBtn("إغلاق","btn",closeModal)]);
    };
    list.appendChild(el);
  });
}

function refreshCardsView(filter="") {
  const list = $("#allCardsList");
  list.innerHTML = "";

  const cards = allCardsArray()
    .filter(c => {
      const f = filter.trim().toLowerCase();
      if (!f) return true;
      return (c.foreign || "").toLowerCase().includes(f) ||
             (c.native || "").toLowerCase().includes(f) ||
             (c.hint || "").toLowerCase().includes(f);
    })
    .sort((a,b) => b.addedAt - a.addedAt);

  if (cards.length === 0) {
    list.innerHTML = `<div class="muted">لا توجد بطاقات.</div>`;
    return;
  }

  cards.forEach(c => {
    const el = document.createElement("div");
    el.className = "card";
    const ignored = !!STATE.ignoreList[c.id];
    el.innerHTML = `
      <div class="cardTop">
        <div>
          <div class="cardTitle">${escapeHTML(c.foreign)}</div>
          <div class="cardSub">${escapeHTML(c.native)}</div>
        </div>
        <div class="badge">${ignored ? "متجاهلة" : `مستوى ${c.level}`}</div>
      </div>
    `;
    el.onclick = () => {
      openModal("تفاصيل البطاقة", `
        <div class="bigText">${escapeHTML(c.hint)}</div>
        <div class="divider"></div>
        <div class="muted">النص: <b>${escapeHTML(c.foreign)}</b></div>
        <div class="muted">الترجمة: <b>${escapeHTML(c.native)}</b></div>
        <div class="muted">المجموعات: <b>${(c.groupKeys||[]).map(k => STATE.groups[k]?.name || k).join("، ")}</b></div>
        <div class="muted">آخر تقييم: <b>${c.lastHintEval || "-"}</b></div>
      `, [
        makeBtn(ignored ? "إلغاء التجاهل" : "تجاهل","btn warn", () => {
          if (ignored) delete STATE.ignoreList[c.id];
          else STATE.ignoreList[c.id] = true;
          STATE.meta.lastActivity = "تم تحديث قائمة التجاهل.";
          saveState(STATE);
          refreshTopbar();
          refreshCardsView($("#cardSearch").value);
          closeModal();
        }),
        makeBtn("إغلاق","btn",closeModal)
      ]);
    };
    list.appendChild(el);
  });
}

/* ---------- Views ---------- */
function showView(id) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#view-${id}`).classList.add("active");

  if (id === "add") {
    // لمنع بقاء نص سابق داخل الحقول
    clearAddInputs();
    refreshAddView();
  }
}

/* ---------- Help texts ---------- */
const HELP_TEXTS = {
  foreignHelp: "أدخل الكلمة أو الجملة باللغة التي تتعلمها. الحقل إلزامي. الحد 45 حرف.",
  nativeHelp: "أدخل الترجمة أو التوضيح بلغتك. الحقل إلزامي. الحد 45 حرف.",
  hintHelp: "أدخل تلميحًا يساعد على التذكر (رمز/إيموجي/وصف). الحقل إلزامي. الحد 60 حرف.",
};

/* ---------- Add flow rules ---------- */
function canExitAddView() {
  // القاعدة الصحيحة: إذا بدأ إضافة اليوم ولم يصل 4 => ممنوع الخروج (حتى لو الحقول فارغة)
  return !addLockActiveToday();
}

function deleteTodayProgressAndExit() {
  const key = getTodayGroupKey();
  const g = STATE.groups[key];

  if (g) {
    g.cardIds.forEach(id => { delete STATE.cards[id]; delete STATE.ignoreList[id]; });
    g.cardIds = [];
  }

  // امسح الحقول فورًا
  clearAddInputs();

  // ألغ القفل
  STATE.meta.addLockDateKey = null;

  STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة.";
  saveState(STATE);

  closeModal();
  showView("home");
  refreshTopbar();
}

function confirmExitAddView() {
  if (canExitAddView()) {
    clearAddInputs();
    showView("home");
    refreshTopbar();
    return;
  }

  openModal("تنبيه", `
    يجب حفظ <b>${MIN_DAILY_FIRST}</b> بطاقات على الأقل قبل الخروج.
  `, [
    makeBtn("حسنًا","btn primary", () => closeModal()),
    makeBtn("حذف وخروج","btn warn", () => deleteTodayProgressAndExit())
  ], { closable:false });
}

function setLockOnAnyInput(){
  const a = $("#inForeign").value.trim();
  const b = $("#inNative").value.trim();
  const c = $("#inHint").value.trim();
  if (a || b || c) {
    setAddLockIfNeeded();
    saveState(STATE);
  }
}

function saveNewCard() {
  const foreign = $("#inForeign").value.trim();
  const native = $("#inNative").value.trim();
  const hint = $("#inHint").value.trim();

  if (!foreign || !native || !hint) {
    AudioFX.beep("bad");
    openModal("خطأ", "جميع الحقول إلزامية.", [makeBtn("إغلاق","btn",closeModal)]);
    return;
  }

  setAddLockIfNeeded(); // بمجرد الحفظ يعتبر بدأ إضافة اليوم

  const cap = todayCapacity();
  const cnt = todayCount();
  if (cnt >= cap) {
    AudioFX.beep("bad");
    openModal("تنبيه", `وصلت للحد اليومي (${cap}).`, [makeBtn("إغلاق","btn",closeModal)]);
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

  // إذا وصل 4: فك القفل
  if (g.cardIds.length >= MIN_DAILY_FIRST) {
    STATE.meta.addLockDateKey = null;
  }

  STATE.meta.lastActivity = `تمت إضافة بطاقة جديدة إلى مجموعة ${g.name}.`;
  saveState(STATE);

  clearAddInputs();
  AudioFX.beep("ok");
  refreshTopbar();
  refreshAddView();
}

/* ---------- Overdue modal (mandatory) ---------- */
function checkOverdueModal() {
  const today = safeTodayKey(STATE);
  const dueGroups = dueGroupsToday();
  if (dueGroups.length === 0) return;

  if (STATE.meta._resolvedDueTodayKey === today) return;
  if (STATE.meta.lastAttendanceDateKey === today) return;

  const decisions = {};

  const body = document.createElement("div");
  body.innerHTML = `<div class="muted" style="margin-bottom:10px">
    لديك مجموعات يومية مستحقة. اختر إجراءً لكل مجموعة ثم اضغط "حسنًا".
  </div>`;

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "10px";

  dueGroups.forEach(g => {
    const row = document.createElement("div");
    row.className = "field";
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="font-weight:1000">لقد فوّت المجموعة <b>${escapeHTML(g.name)}</b>. هل تود مراجعتها؟</div>
        <div class="badge">مستحقة</div>
      </div>
      <div class="btnRow" style="margin-top:10px">
        <button class="btn" data-k="${g.id}" data-v="review">مراجعة</button>
        <button class="btn warn" data-k="${g.id}" data-v="reset">إعادة</button>
        <button class="btn" data-k="${g.id}" data-v="ignore">تجاهل</button>
      </div>
    `;

    row.querySelectorAll("button[data-k]").forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute("data-k");
        const v = b.getAttribute("data-v");
        decisions[k] = v;

        row.querySelectorAll("button[data-k]").forEach(x => x.classList.remove("primary"));
        b.classList.add("primary");
        AudioFX.beep("click");
      };
    });

    list.appendChild(row);
  });

  body.appendChild(list);

  const btnAllReview = makeBtn("مراجعة الكل","btn", () => {
    dueGroups.forEach(g => decisions[g.id] = "review");
    list.querySelectorAll("button[data-v='review']").forEach(b => b.classList.add("primary"));
    list.querySelectorAll("button[data-v='reset'],button[data-v='ignore']").forEach(b => b.classList.remove("primary"));
  });
  const btnAllReset = makeBtn("إعادة الكل","btn warn", () => {
    dueGroups.forEach(g => decisions[g.id] = "reset");
    list.querySelectorAll("button[data-v='reset']").forEach(b => b.classList.add("primary"));
    list.querySelectorAll("button[data-v='review'],button[data-v='ignore']").forEach(b => b.classList.remove("primary"));
  });
  const btnAllIgnore = makeBtn("تجاهل الكل","btn", () => {
    dueGroups.forEach(g => decisions[g.id] = "ignore");
    list.querySelectorAll("button[data-v='ignore']").forEach(b => b.classList.add("primary"));
    list.querySelectorAll("button[data-v='review'],button[data-v='reset']").forEach(b => b.classList.remove("primary"));
  });

  const ok = makeBtn("حسنًا","btn primary", () => {
    const missing = dueGroups.filter(g => !decisions[g.id]);
    if (missing.length) {
      AudioFX.beep("bad");
      return;
    }

    dueGroups.forEach(g => {
      const d = decisions[g.id];
      if (d === "reset") {
        g.cardIds.forEach(id => {
          const c = STATE.cards[id];
          if (c) c.level = 0;
        });
      } else if (d === "ignore") {
        g.cardIds.forEach(id => STATE.ignoreList[id] = true);
      }
    });

    STATE.meta._resolvedDueTodayKey = today;
    STATE.meta.lastActivity = "تم تحديد إجراء للمجموعات المستحقة.";
    saveState(STATE);
    closeModal();
    refreshTopbar();
  });

  openModal("مجموعات مستحقة", body.outerHTML, [btnAllReview, btnAllReset, btnAllIgnore, ok], { closable:false });
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
      makeBtn("موافق","btn primary", closeModal)
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
  };

  const dueIds = cards.map(c=>c.id);
  const thirty = Math.max(1, Math.round(dueIds.length * 0.30));
  const pick1 = shuffle(dueIds).slice(0, thirty);
  const remain = dueIds.filter(id => !pick1.includes(id));
  const pick2 = shuffle(remain).slice(0, Math.min(thirty, remain.length));
  PLAY.scrambledIds = pick1;
  PLAY.typingIds = pick2;

  showView("play");
  $("#btnNextGame").style.display = "";
  $("#btnGoHint").style.display = "";
  $("#btnSkip").style.display = "";
  $("#btnHelp").style.display = "";

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
  refreshTopbar();
  refreshStoreInv();
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
      makeBtn("الذهاب للمتجر","btn primary", ()=>{ closeModal(); showView("store"); refreshStoreInv(); }),
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
      makeBtn("الذهاب للمتجر","btn primary", ()=>{ closeModal(); showView("store"); refreshStoreInv(); }),
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
    scrambled: "لعبة ترتيب الحروف",
    typing: "لعبة الكتابة",
    hint: "لعبة التلميح"
  }[k] || "لعبة");
}
function gameSubtitle(k) {
  return ({
    matching: "اختر نصًا ثم ترجمته. الصحيح يختفي، والخطأ يسمح بإعادة بلا حدود.",
    flip: "تذكر أماكن النص والترجمة. عرض 5 ثوانٍ ثم قلب.",
    scrambled: "رتب أحرف النص الصحيح. 30% من بطاقات اليوم.",
    typing: "اكتب النص الأصلي عند رؤية الترجمة. 30% مختلفة عن ترتيب الحروف.",
    hint: "التقييم إلزامي لتسجيل الحضور."
  }[k] || "");
}

function renderGame(gameKey) {
  $("#gameArea").innerHTML = "";
  $("#playTitle").textContent = gameTitle(gameKey);
  $("#playSub").textContent = gameSubtitle(gameKey);

  $("#btnSkip").style.display = (gameKey !== "hint") ? "" : "none";
  $("#btnHelp").style.display = (gameKey !== "hint") ? "" : "none";

  $("#btnSkip").onclick = () => {
    if (gameKey === "hint") return;
    if (!consumeSkipOrAskBuy()) return;

    openModal("تأكيد التخطي", "هل تريد تخطي هذه اللعبة والحصول على مكاسب مثالية؟", [
      makeBtn("إلغاء","btn", closeModal),
      makeBtn("نعم","btn primary", () => {
        closeModal();
        STATE.inventory.skip -= 1;
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        saveState(STATE);
        afterGameFinished(gameKey);
      })
    ]);
  };

  $("#btnHelp").onclick = () => {
    if (gameKey === "hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    saveState(STATE);
    refreshStoreInv();

    if (gameKey === "matching") matchingHelp();
    if (gameKey === "flip") flipHelp();
    if (gameKey === "scrambled") scrambledHelp();
    if (gameKey === "typing") typingHelp();

    AudioFX.beep("click");
  };

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
  board.className = "gridBoard";
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

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    awardOnWrong(2, 8, Math.max(first.level, t.level), errorFactorFromErrors(MATCH.errors));
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
  board.className = "gridBoard";
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

  FLIP.tiles.forEach(t => {
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

  const wrap = document.createElement("div");
  wrap.className = "scrambleWrap";
  wrap.innerHTML = `
    <div class="muted">بطاقة ${SCR.idx+1} من ${SCR.cards.length}</div>
    <div class="answerBox" id="scrAnswer"></div>
    <div class="letterRow" id="scrLetters"></div>
    <div class="centerRow">
      <button class="btn primary" id="scrOk"><span class="material-symbols-rounded">check</span>موافق</button>
      <button class="btn" id="scrClear"><span class="material-symbols-rounded">backspace</span>مسح</button>
    </div>
  `;
  area.appendChild(wrap);

  const ansEl = $("#scrAnswer");
  const lettersEl = $("#scrLetters");

  shuffled.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "letterBtn";
    b.type = "button";
    b.textContent = ch === " " ? "␠" : ch;
    b.onclick = () => {
      SCR.answer += ch;
      ansEl.textContent = SCR.answer;
      b.disabled = true;
      AudioFX.beep("click");
    };
    lettersEl.appendChild(b);
  });

  $("#scrClear").onclick = () => {
    SCR.answer = "";
    ansEl.textContent = "";
    lettersEl.querySelectorAll("button").forEach(b => b.disabled = false);
    AudioFX.beep("click");
  };

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
      updateHUD();
      openModal("غير صحيح", "الترتيب غير صحيح. حاول مرة أخرى.", [makeBtn("حسنًا","btn primary", closeModal)]);
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
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="muted">بطاقة ${TYP.idx+1} من ${TYP.cards.length}</div>
    <div class="bigText">${escapeHTML(c.native)}</div>
    <div class="divider"></div>
    <div class="field">
      <label>اكتب النص الأصلي</label>
      <input id="typeIn" placeholder="اكتب هنا..." />
      <div class="tiny">المقارنة حرف بحرف وتشمل الرموز.</div>
    </div>
    <div class="centerRow">
      <button class="btn primary" id="typeOk"><span class="material-symbols-rounded">check</span>موافق</button>
    </div>
  `;
  area.appendChild(wrap);

  const input = $("#typeIn");
  input.focus();

  $("#typeOk").onclick = () => {
    const dt = (performance.now() - TYP.lastAt)/1000;
    TYP.lastAt = performance.now();

    const v = input.value;
    if (v === c.foreign) {
      TYP.correct++;
      awardOnCorrect(16, 8, dt, c.level);
      const F = speedFactor(dt);
      const L = levelMultiplier(c.level);
      TYP.goldRaw += (5 * F * L);

      AudioFX.beep("ok");
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2, 10, c.level, errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      updateHUD();
      openModal("غير صحيح", "المحتوى غير صحيح. حاول مرة أخرى.", [makeBtn("حسنًا","btn primary", closeModal)]);
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

/* ---------- Help effects ---------- */
function matchingHelp() {
  const remaining = PLAY.cards.filter(c => !STATE.ignoreList[c.id]);
  if (!remaining.length) return;
  const pick = remaining[Math.floor(Math.random()*remaining.length)];
  const tiles = $$("#gameArea .tile").filter(t => !t.classList.contains("gone"));
  const a = tiles.find(x => x.textContent === pick.foreign);
  const b = tiles.find(x => x.textContent === pick.native);
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
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [makeBtn("حسنًا","btn primary", closeModal)]);
}

function typingHelp() {
  const c = TYP?.cards?.[TYP.idx];
  if (!c) return;
  const input = $("#typeIn");
  if (!input) return;
  const typed = input.value;
  const next = c.foreign.charAt(typed.length);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [makeBtn("حسنًا","btn primary", closeModal)]);
}

/* ---------- After game finished ---------- */
function afterGameFinished(gameKey) {
  const done4 = ["matching","flip","scrambled","typing"].every(g => PLAY.playedGames.includes(g));
  if (done4) $("#btnNextGame").style.display = "none";

  openModal("تم إنهاء اللعبة", `
    <div class="muted">اللعبة: <b>${escapeHTML(gameTitle(gameKey))}</b></div>
    <div class="muted">يمكنك اختيار اللعبة التالية أو الانتقال لتقييم البطاقات.</div>
  `, [
    makeBtn("اللعبة التالية","btn primary", () => {
      closeModal();
      if (!done4) launchNextGame();
    }),
    makeBtn("تقييم البطاقات","btn primary alt", () => {
      closeModal();
      goToHint();
    })
  ]);
}

/* ---------- Hint (mandatory attendance) ---------- */
function goToHint() { renderGame("hint"); }

function gameHint() {
  PLAY.inHint = true;
  stopTimer();

  $("#btnNextGame").style.display = "none";
  $("#btnGoHint").style.display = "none";
  $("#btnSkip").style.display = "none";
  $("#btnHelp").style.display = "none";

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
  wrap.innerHTML = `
    <div class="muted">بطاقة ${PLAY.hintIndex+1} من ${cards.length}</div>
    <div class="divider"></div>
    <div class="bigText">${escapeHTML(c.hint)}</div>
    <div class="centerRow" style="margin-top:10px">
      <div class="muted" style="font-weight:1000">هل عرفتها؟</div>
      <button class="btn primary" id="btnReveal"><span class="material-symbols-rounded">visibility</span>عرض</button>
    </div>
    <div id="revealBox" class="field" style="display:none; margin-top:10px">
      <div class="muted">النص: <b>${escapeHTML(c.foreign)}</b></div>
      <div class="muted">الترجمة: <b>${escapeHTML(c.native)}</b></div>
    </div>
    <div class="rateRow">
      <button class="rateBtn good" id="rateEasy">سهل</button>
      <button class="rateBtn mid" id="rateMid">متوسط</button>
      <button class="rateBtn bad" id="rateHard">صعب</button>
    </div>
  `;
  area.appendChild(wrap);

  $("#btnReveal").onclick = () => {
    $("#revealBox").style.display = "";
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
  saveState(STATE);
  renderHintCard();
}

function finishHintAll() {
  PLAY.completedHintAll = true;

  // commit deltas
  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  // attendance
  const today = safeTodayKey(STATE);
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;
  saveState(STATE);

  AudioFX.beep("coin");
  AudioFX.beep("rank");

  openModal("انتهى الدرس", `
    <div class="bigText">تم تسجيل الحضور.</div>
    <div class="divider"></div>
    <div class="muted">ذهب: <b>${PLAY.goldDelta}</b></div>
    <div class="muted">XP: <b>${PLAY.xpDelta}</b></div>
    <div class="muted">تقييم: <b>${PLAY.ratingDelta}</b></div>
    <div class="muted">يمكنك إعادة اللعب اليوم للحصول على إحصائيات جديدة، وآخر تقييم هو المعتمد.</div>
  `, [
    makeBtn("العودة للرئيسية","btn primary", () => {
      closeModal();
      endPlay(true);
    })
  ], { closable:false });
}

/* ---------- Exit play ---------- */
function cancelLesson() {
  PLAY.goldDelta = 0;
  PLAY.xpDelta = 0;
  PLAY.ratingDelta = 0;
}

function endPlay(goHome=false) {
  stopTimer();
  PLAY = null;
  showView("home");
  refreshTopbar();
  if (goHome) return;
}

function handleExitPlay() {
  if (PLAY && !PLAY.completedHintAll) {
    cancelLesson();
    STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
    saveState(STATE);
  }
  endPlay(true);
}

/* ---------- Store ---------- */
function buyExtraCard() {
  if (STATE.inventory.extraCardsBought >= 2) {
    AudioFX.beep("bad");
    openModal("تنبيه","وصلت للحد اليومي لشراء البطاقات الإضافية (2).",[makeBtn("إغلاق","btn",closeModal)]);
    return;
  }
  if (STATE.wallet.gold < 100) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 100 ذهب.",[makeBtn("إغلاق","btn",closeModal)]);
    return;
  }
  STATE.wallet.gold -= 100;
  STATE.inventory.extraCardsBought += 1;
  STATE.meta.lastActivity = "تم شراء بطاقة إضافية لليوم.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshTopbar(); refreshStoreInv(); refreshAddView();
}

function buySkip() {
  if (STATE.wallet.gold < 900) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 900 ذهب.",[makeBtn("إغلاق","btn",closeModal)]);
    return;
  }
  STATE.wallet.gold -= 900;
  STATE.inventory.skip += 1;
  STATE.meta.lastActivity = "تم شراء تخطي.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshTopbar(); refreshStoreInv();
}

function buyHelp() {
  if (STATE.wallet.gold < 150) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 150 ذهب.",[makeBtn("إغلاق","btn",closeModal)]);
    return;
  }
  STATE.wallet.gold -= 150;
  STATE.inventory.help += 1;
  STATE.meta.lastActivity = "تم شراء مساعدة.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshTopbar(); refreshStoreInv();
}

function buyFuel() {
  if (STATE.wallet.gold < 250) {
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 250 ذهب.",[makeBtn("إغلاق","btn",closeModal)]);
    return;
  }
  STATE.wallet.gold -= 250;
  STATE.inventory.fuel = (STATE.inventory.fuel || 0) + 1;
  STATE.meta.lastActivity = "تم شراء وقود.";
  saveState(STATE);
  AudioFX.beep("coin");
  refreshTopbar(); refreshStoreInv();
}

/* ---------- Start play ---------- */
function handleStartPlay() {
  const cards = buildLessonCards();
  if (cards.length === 0) {
    AudioFX.beep("bad");
    openModal("تنبيه", "لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا", [
      makeBtn("موافق","btn primary", closeModal)
    ]);
    return;
  }

  checkOverdueModal();

  // إذا تم حل نافذة الاستحقاق، يبدأ اللعب
  const today = safeTodayKey(STATE);
  if (STATE.meta._resolvedDueTodayKey === today || STATE.meta.lastAttendanceDateKey === today) startLesson();
  else startLesson(); // حتى لو ما ظهرت نافذة (حالات بسيطة)
}

/* ---------- Export/Import ---------- */
function exportJSON() {
  const data = JSON.stringify(STATE, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "memorize_backup.json";
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
      openModal("تم", "تم الاستيراد بنجاح.", [makeBtn("إغلاق","btn primary", closeModal)]);
    }catch{
      AudioFX.beep("bad");
      openModal("خطأ", "ملف غير صالح.", [makeBtn("إغلاق","btn", closeModal)]);
    }
  };
  reader.readAsText(file);
}

/* ---------- If user tries to bypass add-lock by closing/refreshing ---------- */
function enforceAddLockOnUnload() {
  window.addEventListener("beforeunload", () => {
    // إذا اليوم مقفول ولم يصل 4: احذف الإضافة غير المكتملة تلقائيًا
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
  });
}

/* ---------- Wire UI ---------- */
function wireUI() {
  $("#btnStart").onclick = () => { AudioFX.beep("click"); handleStartPlay(); };
  $("#btnAdd").onclick = () => { AudioFX.beep("click"); showView("add"); };
  $("#btnStore").onclick = () => { AudioFX.beep("click"); showView("store"); refreshStoreInv(); };
  $("#btnCards").onclick = () => { AudioFX.beep("click"); showView("cards"); refreshCardsView(); };

  $("#btnBackFromAdd").onclick = () => { AudioFX.beep("click"); confirmExitAddView(); };
  $("#btnSaveCard").onclick = () => { AudioFX.beep("click"); saveNewCard(); };

  ["#inForeign","#inNative","#inHint"].forEach(id=>{
    $(id).addEventListener("input", () => {
      setLockOnAnyInput();
    });
  });

  $("#btnBackFromStore").onclick = () => { AudioFX.beep("click"); showView("home"); };
  $("#buyExtraCard").onclick = () => { AudioFX.beep("click"); buyExtraCard(); };
  $("#buySkip").onclick = () => { AudioFX.beep("click"); buySkip(); };
  $("#buyHelp").onclick = () => { AudioFX.beep("click"); buyHelp(); };
  $("#buyFuel").onclick = () => { AudioFX.beep("click"); buyFuel(); };

  $("#btnBackFromCards").onclick = () => { AudioFX.beep("click"); showView("home"); };
  $("#cardSearch").addEventListener("input", (e)=> refreshCardsView(e.target.value));
  $("#btnExport").onclick = () => { AudioFX.beep("click"); exportJSON(); };
  $("#btnImport").onclick = () => { AudioFX.beep("click"); $("#importFile").click(); };
  $("#importFile").addEventListener("change", (e)=> {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = "";
  });

  $("#btnExitPlay").onclick = () => { AudioFX.beep("click"); handleExitPlay(); };
  $("#btnNextGame").onclick = () => { AudioFX.beep("click"); launchNextGame(); };
  $("#btnGoHint").onclick = () => { AudioFX.beep("click"); goToHint(); };

  $$(".qBtn").forEach(b => {
    b.onclick = () => {
      AudioFX.beep("click");
      const key = b.getAttribute("data-help");
      openModal("مساعدة", HELP_TEXTS[key] || "لا توجد.", [makeBtn("إغلاق","btn primary", closeModal)]);
    };
  });
}

/* ---------- Refresh all ---------- */
function refreshAll() {
  ensureDayRollover();
  getOrCreateTodayGroup();
  refreshTopbar();
  refreshStoreInv();
  refreshAddView();
  refreshCardsView($("#cardSearch")?.value || "");
}

/* ---------- Init ---------- */
(function init() {
  ensureDayRollover();
  getOrCreateTodayGroup();
  wireUI();
  enforceAddLockOnUnload();
  refreshAll();
  checkOverdueModal();
})();