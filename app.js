import { auth } from "./firebase.js";
import {
  qs, qsa, escapeHTML,
  guardApp,
  TIERS, DUE_LEVELS,
  formatGroupName, nowISODateKey, daysBetween, addDays,
  accountLevelFromXP,
  difficultyD, levelMultiplier, speedFactor,
  targetProgressForRank, tierMaxSub,
  ensureUserDoc, watchUserState, saveUserState,
  doLogout, doDeleteAccountHard, reauthWithPassword
} from "./auth-guard.js";

/* =========================
   State (Cloud only)
   ========================= */
let USER = null;
let STATE = null;           // latest from cloud
let UNSUB = null;           // snapshot unsub

const MAX_DAILY_BASE = 10;
const MIN_DAILY_FIRST = 4;

function uuid(){
  return "c_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function getTodayKey(){ return nowISODateKey(); }

function getOrCreateTodayGroup(){
  const today = getTodayKey();
  if (!STATE.groups[today]){
    STATE.groups[today] = { id: today, name: formatGroupName(today), dateKey: today, cardIds: [] };
  }
  return STATE.groups[today];
}

function todayCapacity(){
  const extra = Math.min(2, STATE.inventory.extraCardsBought || 0);
  return MAX_DAILY_BASE + extra;
}
function todayCount(){
  const g = STATE.groups[getTodayKey()];
  return g ? g.cardIds.length : 0;
}
function allCardsArray(){
  return Object.values(STATE.cards || {});
}

/* =========================
   Audio FX (simple)
   ========================= */
const AudioFX = (() => {
  let ctx=null;
  function init(){
    if (!ctx) ctx = new (window.AudioContext||window.webkitAudioContext)();
  }
  function beep(type="click"){
    try{
      init();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      let freq=440, dur=0.06, vol=0.05;
      if (type==="ok"){freq=740; dur=0.07; vol=0.06;}
      if (type==="bad"){freq=180; dur=0.10; vol=0.07;}
      if (type==="coin"){freq=920; dur=0.05; vol=0.05;}
      if (type==="rank"){freq=520; dur=0.12; vol=0.06;}
      if (type==="tap"){freq=480; dur=0.04; vol=0.04;}
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
function openModal(title, bodyHTML, buttons=[], opts={}){
  const host = qs("#modalHost");
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
  closeBtn.onclick = ()=>closeModal();
  head.appendChild(closeBtn);

  const body = document.createElement("div");
  body.innerHTML = bodyHTML;

  const foot = document.createElement("div");
  foot.className = "rowActions";
  foot.style.marginTop = "12px";
  buttons.forEach(b=>foot.appendChild(b));

  modal.appendChild(head);
  modal.appendChild(body);
  if (buttons.length) modal.appendChild(foot);

  host.appendChild(modal);
  host.classList.add("show");

  host.onclick = closable ? (e)=>{ if (e.target===host) closeModal(); } : null;
}

function closeModal(){
  const host = qs("#modalHost");
  host.classList.remove("show");
  host.innerHTML="";
}

function makeBtn(html, cls="btn", onClick=()=>{}){
  const b=document.createElement("button");
  b.className=cls;
  b.type="button";
  b.innerHTML=html;
  b.onclick=onClick;
  return b;
}

/* =========================
   FX visual (confetti dots)
   ========================= */
function burstFX(xPct=50,yPct=50,count=12){
  const layer = qs("#fxLayer");
  if (!layer) return;
  for (let i=0;i<count;i++){
    const d = document.createElement("div");
    d.className="fxDot";
    d.style.left = `${xPct}%`;
    d.style.top  = `${yPct}%`;
    const dx = (Math.random()*220 - 110).toFixed(0) + "px";
    const dy = (Math.random()*220 - 110).toFixed(0) + "px";
    d.style.setProperty("--dx", dx);
    d.style.setProperty("--dy", dy);
    layer.appendChild(d);
    setTimeout(()=>d.remove(), 700);
  }
}

/* =========================
   Daily progression FIX (midnight + absence rules)
   =========================
   القاعدة:
   - المستوى يزيد يوميًا تلقائيًا.
   - إذا وصل في يومٍ ما إلى مستوى عرض (1/3/6/7) ولم يحصل حضور بذلك اليوم،
     يتجمّد عند هذا المستوى ولا يستمر بالزيادة في الأيام التالية حتى يراجع المستخدم (ويحصل حضور لاحقًا).
*/
function advanceCardsUpToToday(){
  const today = getTodayKey();
  const lastOpen = STATE.meta.lastOpenDateKey || today;
  const delta = daysBetween(lastOpen, today);
  if (delta <= 0){
    STATE.meta.lastOpenDateKey = today;
    return;
  }

  // معالجة ستريك/وقود عند انتقال الأيام
  // إذا لم يحصل حضور في يوم lastOpen: يمكن استهلاك وقود يوم واحد فقط عند أول يوم غياب
  // هنا نطبق منطق بسيط: إذا هناك فجوة يوم/أكثر والحضور ليس على اليوم السابق -> ستريك يصفّر إلا إذا يوجد وقود
  const yesterday = addDays(today, -1);
  if (STATE.meta.lastAttendanceDateKey !== yesterday && STATE.meta.lastAttendanceDateKey !== today){
    if ((STATE.inventory.fuel||0) > 0){
      STATE.inventory.fuel -= 1;
      STATE.meta.lastActivity = "تم استخدام 1 وقود لحماية الحماسة.";
      AudioFX.beep("coin");
    } else {
      STATE.meta.streak = 0;
    }
  }

  // تقدّم البطاقات يومًا بيوم
  const cards = Object.values(STATE.cards||{});
  for (const c of cards){
    if (!c) continue;

    const lastAdv = c.lastAdvanceDateKey || c.addDateKey || lastOpen;
    const steps = daysBetween(lastAdv, today);
    if (steps <= 0) continue;

    let curKey = lastAdv;

    for (let i=0;i<steps;i++){
      const nextKey = addDays(curKey, 1);

      // إذا البطاقة “مجمّدة” على مستوى عرض بسبب غياب سابق: لا تزيد
      if (c.frozenDue === true && DUE_LEVELS.has(c.level)){
        curKey = nextKey;
        continue;
      }

      // رفع المستوى حتى 6
      if (c.level < 6) c.level += 1;

      // عمر 30 يوم -> مستوى 7
      const age = daysBetween(c.addDateKey, nextKey);
      if (age >= 30) c.level = 7;

      // إذا اليوم الجديد هو يوم عرض، ولم يكن هناك حضور بذلك اليوم → جمّد
      // ملاحظة: الحضور يعني lastAttendanceDateKey === nextKey
      if (DUE_LEVELS.has(c.level) && STATE.meta.lastAttendanceDateKey !== nextKey){
        c.frozenDue = true;
      }

      curKey = nextKey;
    }

    c.lastAdvanceDateKey = today;
  }

  // تصفير مشتريات البطاقات الإضافية عند بداية يوم جديد + استرجاع 50% إن لم تُستخدم
  const unused = Math.max(0, (STATE.inventory.extraCardsBought||0) - (STATE.inventory.extraCardsUsed||0));
  if (unused > 0){
    const refund = Math.floor(unused * 100 * 0.5);
    STATE.wallet.gold += refund;
    STATE.meta.lastActivity = `تمت إعادة ${refund} ذهب (50% من بطاقات إضافية غير مستخدمة).`;
    AudioFX.beep("coin");
  }
  STATE.inventory.dateKey = today;
  STATE.inventory.extraCardsBought = 0;
  STATE.inventory.extraCardsUsed = 0;
  STATE.meta.addLockDateKey = null;

  STATE.meta.lastOpenDateKey = today;
}

/* =========================
   Due cards (today)
   ========================= */
function dueCardsToday(){
  return allCardsArray()
    .filter(c => !STATE.ignoreList?.[c.id])
    .filter(c => DUE_LEVELS.has(c.level));
}
function dueGroupsToday(){
  const due = new Set(dueCardsToday().flatMap(c=>c.groupKeys||[]));
  return Array.from(due).map(k=>STATE.groups[k]).filter(Boolean);
}

/* =========================
   Rank update
   ========================= */
function applyRatingDelta(delta){
  if (!delta) return;
  const r = STATE.rank;
  r.progress += delta;

  while (r.progress >= targetProgressForRank(r.tierIndex, r.subLevel)){
    r.progress -= targetProgressForRank(r.tierIndex, r.subLevel);
    r.subLevel++;
    if (r.subLevel > tierMaxSub(r.tierIndex)){
      r.tierIndex++;
      r.subLevel = 1;
      if (r.tierIndex > 11) r.tierIndex = 11;
    }
    AudioFX.beep("rank");
  }

  while (r.progress < 0){
    if (r.subLevel > 1){
      r.subLevel--;
      r.progress += targetProgressForRank(r.tierIndex, r.subLevel);
    } else if (r.tierIndex > 0){
      r.tierIndex--;
      r.subLevel = tierMaxSub(r.tierIndex);
      r.progress += targetProgressForRank(r.tierIndex, r.subLevel);
    } else {
      r.progress = 0;
      break;
    }
  }
}

/* =========================
   UI refresh
   ========================= */
function refreshHUD(){
  const g = getOrCreateTodayGroup();
  qs("#todayLabel").textContent = `مجموعة اليوم: ${g.name}`;
  qs("#goldLabel").textContent = STATE.wallet.gold;

  const acc = accountLevelFromXP(STATE.wallet.xp);
  qs("#xpLabel").textContent = `LV ${acc.level}`;
  qs("#rankLabel").textContent = `${TIERS[STATE.rank.tierIndex]} ${STATE.rank.subLevel}`;
  qs("#streakLabel").textContent = STATE.meta.streak;

  qs("#userLabel").textContent = (STATE.profile?.displayName || USER?.displayName || "الحساب");

  const xpPct = Math.max(0, Math.min(100, ((STATE.wallet.xp - acc.curMinXP)/Math.max(1,(acc.nextMinXP-acc.curMinXP)))*100));
  qs("#xpBar").style.width = `${xpPct.toFixed(1)}%`;
  qs("#xpSub").textContent = `XP: ${STATE.wallet.xp} (للقادم: ${acc.toNext})`;

  const need = targetProgressForRank(STATE.rank.tierIndex, STATE.rank.subLevel);
  const rankPct = Math.max(0, Math.min(100, (STATE.rank.progress/Math.max(1,need))*100));
  qs("#rankBar").style.width = `${rankPct.toFixed(1)}%`;
  qs("#rankSub").textContent = `تقدّم: ${STATE.rank.progress} / ${need}`;

  const due = dueCardsToday().length;
  const groupsDue = dueGroupsToday().length;
  qs("#dueCountLabel").textContent = due;
  qs("#dueSub").textContent = `مجموعات مستحقة: ${groupsDue} | سعة اليوم: ${todayCapacity()}`;

  qs("#chipSkip").textContent = `تخطي: ${STATE.inventory.skip||0}`;
  qs("#chipHelp").textContent = `مساعدة: ${STATE.inventory.help||0}`;
  qs("#chipFuel").textContent = `وقود: ${STATE.inventory.fuel||0}`;

  const invExtra = Math.max(0, (STATE.inventory.extraCardsBought||0) - (STATE.inventory.extraCardsUsed||0));
  qs("#invLine").textContent = `إضافي اليوم: ${invExtra} | تخطي: ${STATE.inventory.skip||0} | مساعدة: ${STATE.inventory.help||0} | وقود: ${STATE.inventory.fuel||0}`;

  const cap = todayCapacity();
  const cnt = todayCount();
  qs("#addHint").textContent = `بطاقات اليوم: ${cnt} / ${cap} | أول إضافة: لا خروج قبل ${MIN_DAILY_FIRST} أو حذف وخروج.`;
  qs("#addStats").textContent = STATE.meta.lastActivity || "—";
}

function refreshTodayList(){
  const g = getOrCreateTodayGroup();
  const list = qs("#todayList");
  list.innerHTML = "";

  g.cardIds.slice().reverse().forEach(id=>{
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
    el.onclick = ()=>el.classList.toggle("open");
    list.appendChild(el);
  });

  if (!g.cardIds.length){
    list.innerHTML = `<div class="muted">لا توجد بطاقات اليوم بعد.</div>`;
  }
}

function refreshCardsList(filter=""){
  const list = qs("#cardsList");
  list.innerHTML = "";
  const f = filter.trim().toLowerCase();

  const cards = allCardsArray()
    .filter(c=>{
      if (!f) return true;
      return (c.foreign||"").toLowerCase().includes(f) ||
             (c.native||"").toLowerCase().includes(f) ||
             (c.hint||"").toLowerCase().includes(f);
    })
    .sort((a,b)=> b.addedAt - a.addedAt);

  if (!cards.length){
    list.innerHTML = `<div class="muted">لا توجد بطاقات.</div>`;
    return;
  }

  cards.forEach(c=>{
    const ignored = !!STATE.ignoreList?.[c.id];
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
        <span class="badge">آخر تقييم: ${escapeHTML(c.lastHintEval || "-")}</span>
      </div>
    `;
    el.onclick = ()=>{
      openModal("تفاصيل البطاقة", `
        <div class="modalRow">
          <div><b>النص:</b> ${escapeHTML(c.foreign)}</div>
          <div><b>الترجمة:</b> ${escapeHTML(c.native)}</div>
          <div><b>التلميح:</b> ${escapeHTML(c.hint)}</div>
          <div><b>المستوى:</b> ${ignored ? "متجاهلة" : c.level}</div>
          <div><b>آخر تقييم:</b> ${escapeHTML(c.lastHintEval || "-")}</div>
        </div>
      `, [
        makeBtn(`<span class="material-icons">visibility_off</span> ${ignored ? "إلغاء التجاهل" : "تجاهل"}`, "btn btn--primary", async ()=>{
          if (ignored) delete STATE.ignoreList[c.id];
          else STATE.ignoreList[c.id] = true;
          STATE.meta.lastActivity = "تم تحديث قائمة التجاهل.";
          await saveUserState(USER.uid, STATE);
          closeModal();
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
function showView(name){
  qsa(".view").forEach(v=>v.classList.remove("active"));
  qs(`#view-${name}`).classList.add("active");
  qsa(".nav__btn").forEach(b=>b.classList.toggle("active", b.dataset.view === name));

  if (name==="add"){
    clearAddInputs();
    refreshTodayList();
  }
  if (name==="cards"){
    refreshCardsList(qs("#cardsSearch").value || "");
  }
  refreshHUD();
}

/* =========================
   Add flow (cloud)
   ========================= */
function clearAddInputs(){
  qs("#inFront").value="";
  qs("#inBack").value="";
  qs("#inHint").value="";
}

function addLockActiveToday(){
  const today = getTodayKey();
  return STATE.meta.addLockDateKey === today && todayCount() < MIN_DAILY_FIRST;
}
function setAddLockIfNeeded(){
  const today = getTodayKey();
  if (todayCount() >= MIN_DAILY_FIRST){
    STATE.meta.addLockDateKey = null;
    return;
  }
  STATE.meta.addLockDateKey = today;
}
function canExitAddView(){
  return !addLockActiveToday();
}

async function deleteTodayProgressAndExit(){
  const today = getTodayKey();
  const g = STATE.groups[today];
  if (g){
    g.cardIds.forEach(id=>{
      delete STATE.cards[id];
      delete STATE.ignoreList[id];
    });
    g.cardIds = [];
  }
  STATE.meta.addLockDateKey = null;
  STATE.meta.lastActivity = "تم حذف إضافة اليوم غير المكتملة.";
  await saveUserState(USER.uid, STATE);
  closeModal();
  showView("home");
}

function confirmExitAddView(){
  if (canExitAddView()){ showView("home"); return; }
  openModal("تنبيه", `يجب حفظ <b>${MIN_DAILY_FIRST}</b> بطاقات على الأقل قبل الخروج.`, [
    makeBtn("حسنًا","btn btn--primary", closeModal),
    makeBtn("حذف وخروج","btn btn--danger", ()=>deleteTodayProgressAndExit())
  ], {closable:false});
}

function setLockOnAnyInput(){
  const a = qs("#inFront").value.trim();
  const b = qs("#inBack").value.trim();
  const c = qs("#inHint").value.trim();
  if (a || b || c){
    setAddLockIfNeeded();
  }
}

async function saveNewCard(){
  const foreign = qs("#inFront").value.trim();
  const native  = qs("#inBack").value.trim();
  const hint    = qs("#inHint").value.trim();

  if (!foreign || !native || !hint){
    AudioFX.beep("bad");
    openModal("خطأ", "جميع الحقول إلزامية.", [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    return;
  }

  setAddLockIfNeeded();

  const cap = todayCapacity();
  const cnt = todayCount();
  if (cnt >= cap){
    AudioFX.beep("bad");
    openModal("تنبيه", `وصلت للحد اليومي (${cap}).`, [ makeBtn("إغلاق","btn btn--primary", closeModal) ]);
    return;
  }

  const g = getOrCreateTodayGroup();
  const id = uuid();
  const today = getTodayKey();

  const card = {
    id,
    foreign,
    native,
    hint,
    groupKeys: [today],
    level: 0,
    frozenDue: false,
    addedAt: Date.now(),
    addDateKey: today,
    lastAdvanceDateKey: today,
    lastHintEval: null,
    lastHintEvalAt: null
  };

  STATE.cards[id] = card;
  g.cardIds.push(id);

  if (g.cardIds.length > MAX_DAILY_BASE){
    const over = g.cardIds.length - MAX_DAILY_BASE;
    STATE.inventory.extraCardsUsed = Math.max(STATE.inventory.extraCardsUsed, over);
  }

  if (g.cardIds.length >= MIN_DAILY_FIRST) STATE.meta.addLockDateKey = null;

  STATE.meta.lastActivity = `تمت إضافة بطاقة جديدة إلى مجموعة ${g.name}.`;
  await saveUserState(USER.uid, STATE);

  clearAddInputs();
  AudioFX.beep("ok");
}

/* =========================
   Overdue modal (mandatory)
   ========================= */
function checkOverdueModal(){
  const today = getTodayKey();
  const dueGroups = dueGroupsToday();
  if (dueGroups.length === 0) return;

  if (STATE.meta.resolvedOverdueDateKey === today) return;
  if (STATE.meta.lastAttendanceDateKey === today) return;

  const decisions = {};
  let body = `<div class="muted" style="margin-bottom:10px">لديك مجموعات يومية مستحقة. اختر إجراءً لكل مجموعة ثم اضغط "حسنًا".</div>`;

  dueGroups.forEach(g=>{
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

  const btnAllReview = makeBtn("مراجعة الكل","btn", ()=>{
    dueGroups.forEach(g=>decisions[g.id]="review"); syncChoiceUI("review");
  });
  const btnAllReset = makeBtn("إعادة الكل","btn btn--danger", ()=>{
    dueGroups.forEach(g=>decisions[g.id]="reset"); syncChoiceUI("reset");
  });
  const btnAllIgnore = makeBtn("تجاهل الكل","btn", ()=>{
    dueGroups.forEach(g=>decisions[g.id]="ignore"); syncChoiceUI("ignore");
  });

  const ok = makeBtn("حسنًا","btn btn--primary", async ()=>{
    const missing = dueGroups.filter(g=>!decisions[g.id]);
    if (missing.length){ AudioFX.beep("bad"); return; }

    dueGroups.forEach(g=>{
      const d = decisions[g.id];
      if (d === "reset"){
        g.cardIds.forEach(id=>{
          const c = STATE.cards[id];
          if (c){
            c.level = 0;
            c.frozenDue = false;
          }
        });
      } else if (d === "ignore"){
        g.cardIds.forEach(id=>STATE.ignoreList[id]=true);
      } else {
        // review: فقط فك التجميد ليقدر يكمل
        g.cardIds.forEach(id=>{
          const c = STATE.cards[id];
          if (c) c.frozenDue = false;
        });
      }
    });

    STATE.meta.resolvedOverdueDateKey = today;
    STATE.meta.lastActivity = "تم تحديد إجراء للمجموعات المستحقة.";
    await saveUserState(USER.uid, STATE);
    closeModal();
  });

  openModal("مجموعات مستحقة", body, [btnAllReview, btnAllReset, btnAllIgnore, ok], {closable:false});

  qs("#modalHost").querySelectorAll("button.choiceBtn[data-k]").forEach(b=>{
    b.onclick = ()=>{
      const k = b.getAttribute("data-k");
      const v = b.getAttribute("data-v");
      decisions[k] = v;
      const row = b.closest(".modalRow");
      row.querySelectorAll(".choiceBtn").forEach(x=>x.classList.remove("on"));
      b.classList.add("on");
      AudioFX.beep("tap");
    };
  });

  function syncChoiceUI(which){
    qs("#modalHost").querySelectorAll(".modalRow").forEach(row=>{
      row.querySelectorAll(".choiceBtn").forEach(x=>x.classList.remove("on"));
      const btn = row.querySelector(`.choiceBtn[data-v="${which}"]`);
      if (btn) btn.classList.add("on");
    });
  }
}

/* =========================
   Lesson / Games
   ========================= */
let PLAY = null;

function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function buildLessonCards(){ return dueCardsToday(); }

function startLesson(){
  const cards = buildLessonCards();
  if (cards.length === 0){
    AudioFX.beep("bad");
    openModal("تنبيه", `لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا`, [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }

  const gameQueue = shuffle(["matching","flip","scrambled","typing"]);
  const dueIds = cards.map(c=>c.id);
  const thirty = Math.max(1, Math.round(dueIds.length * 0.30));
  const pick1 = shuffle(dueIds).slice(0, thirty);
  const remain = dueIds.filter(id=>!pick1.includes(id));
  const pick2 = shuffle(remain).slice(0, Math.min(thirty, remain.length));

  PLAY = {
    timer:null, sec:0,
    goldDelta:0, xpDelta:0, ratingDelta:0,
    usedHelpInGame:false,
    cards,
    gameQueue,
    playedGames:[],
    inHint:false,
    scrambledIds: pick1,
    typingIds: pick2,
    hintIndex:0,
    completedHintAll:false,
    helpLogs:{matching:[], flip:[], scrambled:[], typing:[]},
    currentGame:null
  };

  showView("game");
  qs("#btnNextGame").style.display="";
  qs("#btnGoHint").style.display="";
  qs("#btnUseSkip").style.display="";
  qs("#btnUseHelp").style.display="";
  qs("#btnHelpLog").style.display="";

  updateHUD();
  startTimer();
  launchNextGame();
}

function startTimer(){
  stopTimer();
  PLAY.sec=0;
  qs("#hudTime").textContent="0.0s";
  PLAY.timer=setInterval(()=>{
    PLAY.sec+=0.1;
    qs("#hudTime").textContent=`${PLAY.sec.toFixed(1)}s`;
  },100);
}
function stopTimer(){
  if (PLAY?.timer) clearInterval(PLAY.timer);
  if (PLAY) PLAY.timer=null;
}
function updateHUD(){
  qs("#hudGold").textContent = (PLAY.goldDelta>=0?"+":"") + PLAY.goldDelta;
  qs("#hudXP").textContent   = (PLAY.xpDelta>=0?"+":"") + PLAY.xpDelta;
  qs("#hudRate").textContent = (PLAY.ratingDelta>=0?"+":"") + PLAY.ratingDelta;
  refreshHUD();
}

function currentAverageLevelMultiplier(){
  const lvls = PLAY.cards.map(c=>levelMultiplier(c.level));
  return lvls.reduce((a,b)=>a+b,0)/Math.max(1,lvls.length);
}

function applyPerfectGameRewards(){
  const L = currentAverageLevelMultiplier();
  const D = difficultyD(STATE.rank);
  PLAY.goldDelta += 75;
  PLAY.xpDelta   += Math.round(220 * L);
  PLAY.ratingDelta += Math.round((60 * L) / D);
  AudioFX.beep("coin");
  burstFX(70,20,14);
  updateHUD();
}

function consumeSkipOrAskBuy(){
  if ((STATE.inventory.skip||0) <= 0){
    AudioFX.beep("bad");
    openModal("لا يوجد تخطي", "لا تملك تخطي. يمكن شراؤه من المتجر.", [
      makeBtn("الذهاب للمتجر","btn btn--primary", ()=>{ closeModal(); showView("store"); }),
      makeBtn("إغلاق","btn", closeModal)
    ]);
    return false;
  }
  return true;
}
function consumeHelpOrAskBuy(){
  if ((STATE.inventory.help||0) <= 0){
    AudioFX.beep("bad");
    openModal("لا توجد مساعدة", "لا تملك مساعدات. يمكن شراؤها من المتجر.", [
      makeBtn("الذهاب للمتجر","btn btn--primary", ()=>{ closeModal(); showView("store"); }),
      makeBtn("إغلاق","btn", closeModal)
    ]);
    return false;
  }
  return true;
}

function launchNextGame(){
  PLAY.usedHelpInGame=false;
  const next = PLAY.gameQueue.find(g=>!PLAY.playedGames.includes(g));
  if (!next){
    qs("#btnNextGame").style.display="none";
    return;
  }
  renderGame(next);
}

function gameTitle(k){
  return ({
    matching:"لعبة التوصيل",
    flip:"لعبة قلب البطاقات",
    scrambled:"لعبة ترتيب الأحرف",
    typing:"لعبة الكتابة",
    hint:"لعبة التلميح"
  }[k] || "لعبة");
}
function gameSubtitle(k){
  return ({
    matching:"اختر نصًا ثم ترجمته. الصحيح يختفي، والخطأ يسمح بإعادة بلا حدود.",
    flip:"تذكر أماكن النص والترجمة. عرض 5 ثوانٍ ثم قلب.",
    scrambled:"رتب أحرف النص الصحيح. 30% من بطاقات اليوم.",
    typing:"اكتب النص الأصلي عند رؤية الترجمة. 30% مختلفة عن ترتيب الحروف.",
    hint:"التقييم إلزامي لتسجيل الحضور."
  }[k] || "");
}

function renderGame(gameKey){
  PLAY.currentGame = gameKey;
  qs("#gameArea").innerHTML="";
  qs("#gameTitle").textContent = gameTitle(gameKey);
  qs("#gameSub").textContent = gameSubtitle(gameKey);

  qs("#btnUseSkip").style.display = (gameKey!=="hint") ? "" : "none";
  qs("#btnUseHelp").style.display = (gameKey!=="hint") ? "" : "none";
  qs("#btnHelpLog").style.display = (gameKey!=="hint") ? "" : "none";

  qs("#btnUseSkip").onclick = ()=>{
    if (gameKey==="hint") return;
    if (!consumeSkipOrAskBuy()) return;

    openModal("تأكيد التخطي", "هل تريد تخطي هذه اللعبة والحصول على مكاسب مثالية؟", [
      makeBtn("إلغاء","btn", closeModal),
      makeBtn("نعم","btn btn--primary", async ()=>{
        closeModal();
        STATE.inventory.skip -= 1;
        await saveUserState(USER.uid, STATE);
        applyPerfectGameRewards();
        PLAY.playedGames.push(gameKey);
        afterGameFinished(gameKey);
      })
    ]);
  };

  qs("#btnUseHelp").onclick = async ()=>{
    if (gameKey==="hint") return;
    if (!consumeHelpOrAskBuy()) return;

    STATE.inventory.help -= 1;
    PLAY.usedHelpInGame = true;
    await saveUserState(USER.uid, STATE);

    if (gameKey==="matching") matchingHelp();
    if (gameKey==="flip") flipHelp();
    if (gameKey==="scrambled") scrambledHelp();
    if (gameKey==="typing") typingHelp();

    AudioFX.beep("tap");
    refreshHUD();
  };

  qs("#btnHelpLog").onclick = ()=>showHelpLog(gameKey);

  if (gameKey==="matching") gameMatching();
  if (gameKey==="flip") gameFlip();
  if (gameKey==="scrambled") gameScrambled();
  if (gameKey==="typing") gameTyping();
  if (gameKey==="hint") gameHint();
}

/* -------- Scoring -------- */
function addXP(a){ PLAY.xpDelta += Math.max(0, a|0); }
function addGold(a){ PLAY.goldDelta += (a|0); }
function addRating(a){ PLAY.ratingDelta += (a|0); }

function finalizeGoldWithHelpPenalty(goldRaw, minGold){
  let g = goldRaw;
  if (PLAY.usedHelpInGame) g = Math.floor(g * 0.85);
  g = Math.max(minGold, Math.min(75, g));
  return g;
}
function awardOnCorrect(baseXP, baseRate, sec, cardLevel){
  const F = speedFactor(sec);
  const L = levelMultiplier(cardLevel);
  const D = difficultyD(STATE.rank);
  addXP(Math.round(baseXP * F * L * (1 + 0.01*STATE.rank.tierIndex)));
  addRating(Math.round((baseRate * F * L) / D));
}
function awardOnWrong(minXP, baseLoss, cardLevel, errorFactor=1.0){
  const L = levelMultiplier(cardLevel);
  const D = difficultyD(STATE.rank);
  addXP(Math.round(minXP * L));
  addRating(-Math.round(Math.abs(baseLoss) * errorFactor * L * D));
}
function errorFactorFromErrors(e){
  if (e>=10) return 1.7;
  if (e>=6) return 1.3;
  return 1.0;
}

/* -------- Matching -------- */
let MATCH=null;

function gameMatching(){
  const cards = PLAY.cards;
  const tiles=[];
  cards.forEach(c=>{
    tiles.push({id:"f_"+c.id, kind:"f", cid:c.id, text:c.foreign, level:c.level});
    tiles.push({id:"n_"+c.id, kind:"n", cid:c.id, text:c.native, level:c.level});
  });

  const board=document.createElement("div");
  board.className="grid";
  qs("#gameArea").appendChild(board);

  MATCH = {
    tiles: shuffle(tiles),
    selected:null,
    gone:new Set(),
    errors:0,
    correct:0,
    lastActionAt: performance.now(),
    goldRaw:0
  };

  MATCH.tiles.forEach(t=>{
    const el=document.createElement("div");
    el.className="tile";
    el.dataset.id=t.id;
    el.textContent=t.text;
    el.onclick = ()=>matchingClick(t,el);
    board.appendChild(el);
  });
}

function matchingClick(t, el){
  if (MATCH.gone.has(t.id)) return;
  AudioFX.beep("tap");

  if (MATCH.selected && MATCH.selected.id === t.id){
    MATCH.selected.el.classList.remove("sel");
    MATCH.selected=null;
    return;
  }
  if (!MATCH.selected){
    MATCH.selected={...t, el};
    el.classList.add("sel");
    return;
  }

  const first=MATCH.selected;
  first.el.classList.remove("sel");
  MATCH.selected=null;

  const dt=(performance.now()-MATCH.lastActionAt)/1000;
  MATCH.lastActionAt=performance.now();

  const samePair = (first.cid===t.cid) && (first.kind!==t.kind);

  if (samePair){
    MATCH.gone.add(first.id); MATCH.gone.add(t.id);
    first.el.classList.add("gone","okFlash");
    el.classList.add("gone","okFlash");
    MATCH.correct++;

    awardOnCorrect(12,6,dt,Math.max(first.level,t.level));
    const F = speedFactor(dt);
    const L = levelMultiplier(Math.max(first.level,t.level));
    MATCH.goldRaw += (3*F*L);

    AudioFX.beep("ok");
    burstFX(50,35,10);

    if (MATCH.correct >= PLAY.cards.length) finishMatching();
  } else {
    MATCH.errors++;
    first.el.classList.add("badShake");
    el.classList.add("badShake");
    setTimeout(()=>{first.el.classList.remove("badShake"); el.classList.remove("badShake");}, 380);

    awardOnWrong(2,8,Math.max(first.level,t.level),errorFactorFromErrors(MATCH.errors));
    AudioFX.beep("bad");
  }
  updateHUD();
}

function finishMatching(){
  const C=Math.max(1,MATCH.correct);
  const E=MATCH.errors;
  const ER=E/C;

  let penalty=0;
  if (ER>0.50) penalty=0.45;
  else if (ER>0.25) penalty=0.25;
  else if (ER>0.10) penalty=0.10;

  let gold=Math.floor(MATCH.goldRaw*(1-penalty));
  gold=finalizeGoldWithHelpPenalty(gold,8);
  addGold(gold);
  AudioFX.beep("coin");

  PLAY.playedGames.push("matching");
  afterGameFinished("matching");
}

/* -------- Flip -------- */
let FLIP=null;

function gameFlip(){
  const cards=PLAY.cards;
  const tiles=[];
  cards.forEach(c=>{
    tiles.push({id:"f_"+c.id, kind:"f", cid:c.id, text:c.foreign, level:c.level});
    tiles.push({id:"n_"+c.id, kind:"n", cid:c.id, text:c.native, level:c.level});
  });

  const board=document.createElement("div");
  board.className="grid";
  qs("#gameArea").appendChild(board);

  FLIP = {
    tiles: shuffle(tiles),
    open:[],
    locked:false,
    gone:new Set(),
    pairs:0,
    startAt: performance.now(),
    lastMatchAt: performance.now(),
    goldRaw:0
  };

  // عرض 5 ثواني
  tiles.forEach(t=>{
    const el=document.createElement("div");
    el.className="tile";
    el.dataset.id=t.id;
    el.textContent=t.text;
    board.appendChild(el);
  });

  setTimeout(()=>{
    board.innerHTML="";
    FLIP.tiles.forEach(t=>{
      const el=document.createElement("div");
      el.className="tile back";
      el.dataset.id=t.id;
      el.textContent="✦";
      el.onclick=()=>flipClick(t,el);
      board.appendChild(el);
    });
  }, 5000);
}

function flipClick(t, el){
  if (FLIP.locked) return;
  if (FLIP.gone.has(t.id)) return;

  if (FLIP.open.length===1 && FLIP.open[0].t.id===t.id){
    el.classList.add("back");
    el.textContent="✦";
    FLIP.open=[];
    return;
  }
  if (FLIP.open.length>=2) return;

  AudioFX.beep("tap");
  el.classList.remove("back");
  el.textContent=t.text;
  FLIP.open.push({t,el});

  if (FLIP.open.length===2){
    FLIP.locked=true;
    const [a,b]=FLIP.open;
    const same = (a.t.cid===b.t.cid) && (a.t.kind!==b.t.kind);

    if (same){
      setTimeout(()=>{
        a.el.classList.add("gone","okFlash");
        b.el.classList.add("gone","okFlash");
        FLIP.gone.add(a.t.id); FLIP.gone.add(b.t.id);
        FLIP.pairs++;
        FLIP.open=[];
        FLIP.locked=false;

        const dt=(performance.now()-FLIP.lastMatchAt)/1000;
        FLIP.lastMatchAt=performance.now();

        const F=speedFactor(dt);
        const L=levelMultiplier(Math.max(a.t.level,b.t.level));
        const D=difficultyD(STATE.rank);

        addXP(Math.round(10*F*L*(1+0.01*STATE.rank.tierIndex)));
        addRating(Math.round((5*F*L)/D));
        FLIP.goldRaw += (3.5*F*L);

        AudioFX.beep("ok");
        burstFX(50,35,10);
        updateHUD();

        if (FLIP.pairs>=PLAY.cards.length) finishFlip();
      }, 150);
    } else {
      setTimeout(()=>{
        a.el.classList.add("back"); a.el.textContent="✦";
        b.el.classList.add("back"); b.el.textContent="✦";
        a.el.classList.add("badShake"); b.el.classList.add("badShake");
        setTimeout(()=>{a.el.classList.remove("badShake"); b.el.classList.remove("badShake");}, 380);
        FLIP.open=[];
        FLIP.locked=false;
        AudioFX.beep("bad");
      }, 2000);
    }
  }
}

function finishFlip(){
  const totalSec=(performance.now()-FLIP.startAt)/1000;
  const avgSec= totalSec/Math.max(1,FLIP.pairs);
  if (avgSec>12){
    const L=currentAverageLevelMultiplier();
    const D=difficultyD(STATE.rank);
    addRating(-Math.round(20*L*D));
  }

  let gold=Math.floor(FLIP.goldRaw);
  gold=finalizeGoldWithHelpPenalty(gold,8);
  addGold(gold);
  AudioFX.beep("coin");

  PLAY.playedGames.push("flip");
  afterGameFinished("flip");
}

/* -------- Scrambled -------- */
let SCR=null;

function gameScrambled(){
  const ids = PLAY.scrambledIds;
  const cards = ids.map(id=>STATE.cards[id]).filter(Boolean);
  SCR={cards, idx:0, errors:0, correct:0, goldRaw:0, lastAt:performance.now(), answer:"", picks:[]};
  renderScrambledCard();
}

function renderScrambledCard(){
  const area=qs("#gameArea");
  area.innerHTML="";

  if (SCR.idx>=SCR.cards.length) return finishScrambled();

  const c = SCR.cards[SCR.idx];
  const original = c.foreign;
  const chars = original.split("");
  const shuffled = shuffle(chars);

  SCR.answer="";
  SCR.picks=[];

  const box=document.createElement("div");
  box.className="wordBox";
  box.innerHTML=`
    <div class="muted">بطاقة ${SCR.idx+1} من ${SCR.cards.length}</div>
    <div class="answerLine" id="scrAnswer"></div>
    <div class="lettersRow" id="scrLetters"></div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="scrOk"><span class="material-icons">check</span> موافق</button>
      <button class="btn" id="scrBack"><span class="material-icons">backspace</span> حذف</button>
    </div>
    <div class="muted tiny">الضغط المطوّل على زر الحذف يمسح الكل.</div>
  `;
  area.appendChild(box);

  const ansEl=qs("#scrAnswer");
  const lettersEl=qs("#scrLetters");

  shuffled.forEach((ch, idx)=>{
    const b=document.createElement("button");
    b.className="letterBtn";
    b.type="button";
    b.textContent = ch===" " ? "␠" : ch;
    b.dataset.i = String(idx);
    b.onclick=()=>{
      SCR.answer += ch;
      SCR.picks.push(idx);
      ansEl.textContent = SCR.answer;
      b.disabled=true;
      AudioFX.beep("tap");
    };
    lettersEl.appendChild(b);
  });

  // حذف آخر حرف (نقرة) + مسح الكل (ضغط مطول)
  const backBtn = qs("#scrBack");
  let longPressTimer = null;

  const doBackOne = ()=>{
    if (!SCR.picks.length) return;
    const lastIdx = SCR.picks.pop();
    const btn = lettersEl.querySelector(`button[data-i="${lastIdx}"]`);
    if (btn) btn.disabled = false;
    SCR.answer = SCR.answer.slice(0, -1);
    ansEl.textContent = SCR.answer;
    AudioFX.beep("tap");
  };

  const doClearAll = ()=>{
    SCR.picks = [];
    SCR.answer = "";
    ansEl.textContent = "";
    lettersEl.querySelectorAll("button").forEach(b=>b.disabled=false);
    AudioFX.beep("tap");
  };

  backBtn.addEventListener("mousedown", ()=>{
    longPressTimer = setTimeout(()=>{ doClearAll(); longPressTimer=null; }, 500);
  });
  backBtn.addEventListener("mouseup", ()=>{
    if (longPressTimer){
      clearTimeout(longPressTimer);
      longPressTimer=null;
      doBackOne();
    }
  });
  backBtn.addEventListener("mouseleave", ()=>{
    if (longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
  });
  // mobile
  backBtn.addEventListener("touchstart", (e)=>{
    e.preventDefault();
    longPressTimer = setTimeout(()=>{ doClearAll(); longPressTimer=null; }, 500);
  }, {passive:false});
  backBtn.addEventListener("touchend", (e)=>{
    e.preventDefault();
    if (longPressTimer){
      clearTimeout(longPressTimer);
      longPressTimer=null;
      doBackOne();
    }
  }, {passive:false});

  qs("#scrOk").onclick=()=>{
    const dt=(performance.now()-SCR.lastAt)/1000;
    SCR.lastAt=performance.now();

    if (SCR.answer === original){
      SCR.correct++;
      awardOnCorrect(14,7,dt,c.level);
      const F=speedFactor(dt);
      const L=levelMultiplier(c.level);
      SCR.goldRaw += (4*F*L);

      AudioFX.beep("ok");
      burstFX(50,40,10);
      updateHUD();
      SCR.idx++;
      renderScrambledCard();
    } else {
      SCR.errors++;
      awardOnWrong(2,9,c.level,errorFactorFromErrors(SCR.errors));
      AudioFX.beep("bad");
      updateHUD();
      openModal("غير صحيح", "الترتيب غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
    }
  };
}

function finishScrambled(){
  const C=Math.max(1,SCR.correct);
  const E=SCR.errors;
  const ER=E/C;

  let penalty=0;
  if (ER>0.50) penalty=0.45;
  else if (ER>0.25) penalty=0.25;
  else if (ER>0.10) penalty=0.10;

  let gold=Math.floor(SCR.goldRaw*(1-penalty));
  gold=finalizeGoldWithHelpPenalty(gold,6);
  addGold(gold);
  AudioFX.beep("coin");

  PLAY.playedGames.push("scrambled");
  afterGameFinished("scrambled");
}

/* -------- Typing -------- */
let TYP=null;

function normalizeTyping(s){
  // المطلوب: تجاهل الفراغات قبل/بعد + لا فرق بين كبير/صغير
  return String(s ?? "").trim().toLowerCase();
}

function gameTyping(){
  const ids=PLAY.typingIds;
  const cards=ids.map(id=>STATE.cards[id]).filter(Boolean);
  TYP={cards, idx:0, errors:0, correct:0, goldRaw:0, lastAt:performance.now()};
  renderTypingCard();
}

function renderTypingCard(){
  const area=qs("#gameArea");
  area.innerHTML="";

  if (TYP.idx>=TYP.cards.length) return finishTyping();

  const c=TYP.cards[TYP.idx];
  const box=document.createElement("div");
  box.className="wordBox";
  box.innerHTML=`
    <div class="muted">بطاقة ${TYP.idx+1} من ${TYP.cards.length}</div>
    <div style="margin-top:10px; font-weight:900; font-size:18px; overflow-wrap:anywhere">${escapeHTML(c.native)}</div>
    <div class="divider"></div>
    <div class="typingBox">
      <div class="muted" style="font-weight:900">اكتب النص الأصلي</div>
      <input id="typeIn" placeholder="اكتب هنا..." />
      <div class="muted tiny">لا فرق بين كبير/صغير، ويتم تجاهل الفراغات قبل/بعد.</div>
    </div>
    <div class="rowActions" style="margin-top:12px">
      <button class="btn btn--primary" id="typeOk"><span class="material-icons">check</span> موافق</button>
    </div>
  `;
  area.appendChild(box);

  const input=qs("#typeIn");
  input.focus();

  qs("#typeOk").onclick=()=>{
    const dt=(performance.now()-TYP.lastAt)/1000;
    TYP.lastAt=performance.now();

    const v = normalizeTyping(input.value);
    const target = normalizeTyping(c.foreign);

    if (v === target){
      TYP.correct++;
      awardOnCorrect(16,8,dt,c.level);
      const F=speedFactor(dt);
      const L=levelMultiplier(c.level);
      TYP.goldRaw += (5*F*L);

      AudioFX.beep("ok");
      burstFX(50,40,10);
      updateHUD();
      TYP.idx++;
      renderTypingCard();
    } else {
      TYP.errors++;
      awardOnWrong(2,10,c.level,errorFactorFromErrors(TYP.errors));
      AudioFX.beep("bad");
      updateHUD();
      openModal("غير صحيح", "المحتوى غير صحيح. حاول مرة أخرى.", [
        makeBtn("حسنًا","btn btn--primary", closeModal)
      ]);
    }
  };
}

function finishTyping(){
  const C=Math.max(1,TYP.correct);
  const E=TYP.errors;
  const ER=E/C;

  let penalty=0;
  if (ER>0.50) penalty=0.45;
  else if (ER>0.25) penalty=0.25;
  else if (ER>0.10) penalty=0.10;

  let gold=Math.floor(TYP.goldRaw*(1-penalty));
  gold=finalizeGoldWithHelpPenalty(gold,6);
  addGold(gold);
  AudioFX.beep("coin");

  PLAY.playedGames.push("typing");
  afterGameFinished("typing");
}

/* -------- Help log + help effects -------- */
function logHelp(game, text){
  PLAY.helpLogs[game].push({at: Date.now(), text});
}
function showHelpLog(game){
  const items = PLAY.helpLogs[game] || [];
  if (!items.length){
    openModal("سجل المساعدات", "لا توجد مساعدات مستخدمة في هذه اللعبة.", [
      makeBtn("إغلاق","btn btn--primary", closeModal)
    ]);
    return;
  }
  const html = items.map((it,i)=>`
    <div class="modalRow">
      <div style="font-weight:900">#${i+1}</div>
      <div class="muted" style="margin-top:6px">${escapeHTML(it.text)}</div>
    </div>
  `).join("");
  openModal("سجل المساعدات", html, [
    makeBtn("إغلاق","btn btn--primary", closeModal)
  ]);
}

function matchingHelp(){
  const remaining = PLAY.cards.filter(c=>!STATE.ignoreList?.[c.id]);
  if (!remaining.length) return;
  const pick = remaining[Math.floor(Math.random()*remaining.length)];
  const tiles = qsa("#gameArea .tile").filter(t=>!t.classList.contains("gone"));
  const a = tiles.find(x=>x.textContent===pick.foreign);
  const b = tiles.find(x=>x.textContent===pick.native);
  logHelp("matching", `تم تمييز زوج: "${pick.foreign}" ↔ "${pick.native}"`);
  if (a) a.classList.add("sel");
  if (b) b.classList.add("sel");
  setTimeout(()=>{ if(a) a.classList.remove("sel"); if(b) b.classList.remove("sel"); }, 900);
}
function flipHelp(){
  const tiles = qsa("#gameArea .tile");
  tiles.forEach(el=>{
    const id = el.dataset.id;
    const t = FLIP?.tiles?.find(x=>x.id===id);
    if (!t) return;
    if (FLIP.gone.has(t.id)) return;
    el.classList.remove("back");
    el.textContent = t.text;
  });
  logHelp("flip", "تم كشف البطاقات مؤقتًا لمدة 1.5 ثانية.");
  setTimeout(()=>{
    tiles.forEach(el=>{
      const id = el.dataset.id;
      const t = FLIP?.tiles?.find(x=>x.id===id);
      if (!t) return;
      if (FLIP.gone.has(t.id)) return;
      if (FLIP.open.some(o=>o.t.id===t.id)) return;
      el.classList.add("back");
      el.textContent="✦";
    });
  }, 1500);
}
function scrambledHelp(){
  const c = SCR?.cards?.[SCR.idx];
  if (!c) return;
  const next = c.foreign.charAt(SCR.answer.length);
  logHelp("scrambled", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}
function typingHelp(){
  const c = TYP?.cards?.[TYP.idx];
  if (!c) return;
  const input = qs("#typeIn");
  const typed = input ? input.value : "";
  const next = c.foreign.charAt(typed.length);
  logHelp("typing", `الحرف التالي: ${next || "(لا يوجد)"}`);
  openModal("مساعدة", `الحرف التالي: <b>${escapeHTML(next || "")}</b>`, [
    makeBtn("حسنًا","btn btn--primary", closeModal)
  ]);
}

/* -------- After game finished -------- */
function afterGameFinished(gameKey){
  const done4 = ["matching","flip","scrambled","typing"].every(g=>PLAY.playedGames.includes(g));
  if (done4) qs("#btnNextGame").style.display="none";

  openModal("تم إنهاء اللعبة", `
    <div class="modalRow">
      <div class="muted">اللعبة: <b>${escapeHTML(gameTitle(gameKey))}</b></div>
      <div class="muted" style="margin-top:8px">يمكنك اختيار اللعبة التالية أو الانتقال لتقييم البطاقات.</div>
    </div>
  `, [
    makeBtn(`<span class="material-icons">sports_esports</span> اللعبة التالية`, "btn btn--primary", ()=>{
      closeModal();
      if (!done4) launchNextGame();
    }),
    makeBtn(`<span class="material-icons">task_alt</span> تقييم البطاقات`, "btn btn--primary", ()=>{
      closeModal();
      goToHint();
    })
  ]);
}

/* -------- Hint (attendance) -------- */
function goToHint(){ renderGame("hint"); }

function gameHint(){
  PLAY.inHint=true;
  stopTimer();

  qs("#btnNextGame").style.display="none";
  qs("#btnGoHint").style.display="none";
  qs("#btnUseSkip").style.display="none";
  qs("#btnUseHelp").style.display="none";
  qs("#btnHelpLog").style.display="none";

  PLAY.hintIndex=0;
  renderHintCard();
}

function renderHintCard(){
  const area=qs("#gameArea");
  area.innerHTML="";

  const cards=PLAY.cards;
  if (PLAY.hintIndex>=cards.length) return finishHintAll();

  const c=cards[PLAY.hintIndex];

  const wrap=document.createElement("div");
  wrap.className="hintWrap";
  wrap.innerHTML=`
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

  qs("#btnReveal").onclick=()=>{
    qs("#revealBox").classList.add("open");
    AudioFX.beep("tap");
  };

  qs("#rateEasy").onclick=()=>rateHint(c.id, "سهل");
  qs("#rateMid").onclick =()=>rateHint(c.id, "متوسط");
  qs("#rateHard").onclick=()=>rateHint(c.id, "صعب");
}

function rateHint(cardId, evalText){
  const c = STATE.cards[cardId];
  if (!c) return;

  // فك التجميد لأن المستخدم راجعها
  c.frozenDue = false;

  if (evalText==="صعب") c.level=0;
  else if (evalText==="متوسط") c.level = (c.level<=3) ? 0 : 2;
  // سهل: لا تغيير، يتابع الجدول

  c.lastHintEval = evalText;
  c.lastHintEvalAt = Date.now();

  PLAY.hintIndex++;
  AudioFX.beep("ok");
  renderHintCard();
}

async function finishHintAll(){
  PLAY.completedHintAll=true;

  STATE.wallet.gold += PLAY.goldDelta;
  STATE.wallet.xp   += PLAY.xpDelta;
  applyRatingDelta(PLAY.ratingDelta);

  const today = getTodayKey();
  if (STATE.meta.lastAttendanceDateKey !== today) STATE.meta.streak += 1;
  STATE.meta.lastAttendanceDateKey = today;
  STATE.meta.resolvedOverdueDateKey = today;

  STATE.meta.lastActivity = `تم تسجيل حضور اليوم. ربح: ذهب ${PLAY.goldDelta}, XP ${PLAY.xpDelta}, تقييم ${PLAY.ratingDelta}.`;

  // عند الحضور: فك تجميد أي بطاقات وصلت due سابقًا (لأنه حضر اليوم)
  Object.values(STATE.cards||{}).forEach(c=>{
    if (c) c.frozenDue = false;
  });

  await saveUserState(USER.uid, STATE);

  AudioFX.beep("coin");
  AudioFX.beep("rank");
  burstFX(60,20,18);

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
    makeBtn(`<span class="material-icons">home</span> العودة للرئيسية`, "btn btn--primary", ()=>{
      closeModal();
      endPlay(true);
    })
  ], {closable:false});
}

/* -------- Cancel / Abort -------- */
function cancelLesson(){
  if (!PLAY) return;
  PLAY.goldDelta=0; PLAY.xpDelta=0; PLAY.ratingDelta=0;
}
function endPlay(goHome=false){
  stopTimer();
  PLAY=null;
  showView("home");
  if (goHome) return;
}
async function handleAbortLesson(){
  if (PLAY && !PLAY.completedHintAll){
    cancelLesson();
    STATE.meta.lastActivity = "تم إلغاء الدرس لعدم إكمال تقييم البطاقات.";
    await saveUserState(USER.uid, STATE);
  }
  endPlay(true);
}

/* =========================
   Store (cloud)
   ========================= */
async function buyExtraCard(){
  if ((STATE.inventory.extraCardsBought||0) >= 2){
    AudioFX.beep("bad");
    openModal("تنبيه","وصلت للحد اليومي لشراء البطاقات الإضافية (2).",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  if (STATE.wallet.gold < 100){
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 100 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 100;
  STATE.inventory.extraCardsBought = (STATE.inventory.extraCardsBought||0) + 1;
  STATE.meta.lastActivity = "تم شراء بطاقة إضافية لليوم.";
  await saveUserState(USER.uid, STATE);
  AudioFX.beep("coin");
}
async function buySkip(){
  if (STATE.wallet.gold < 900){
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 900 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 900;
  STATE.inventory.skip = (STATE.inventory.skip||0) + 1;
  STATE.meta.lastActivity = "تم شراء تخطي.";
  await saveUserState(USER.uid, STATE);
  AudioFX.beep("coin");
}
async function buyHelp(){
  if (STATE.wallet.gold < 150){
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 150 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 150;
  STATE.inventory.help = (STATE.inventory.help||0) + 1;
  STATE.meta.lastActivity = "تم شراء مساعدة.";
  await saveUserState(USER.uid, STATE);
  AudioFX.beep("coin");
}
async function buyFuel(){
  if (STATE.wallet.gold < 250){
    AudioFX.beep("bad");
    openModal("لا يكفي ذهب","تحتاج 250 ذهب.",[
      makeBtn("إغلاق","btn btn--primary",closeModal)
    ]);
    return;
  }
  STATE.wallet.gold -= 250;
  STATE.inventory.fuel = (STATE.inventory.fuel||0) + 1;
  STATE.meta.lastActivity = "تم شراء وقود.";
  await saveUserState(USER.uid, STATE);
  AudioFX.beep("coin");
}

/* =========================
   Start play
   ========================= */
function handleStartPlay(){
  const cards = buildLessonCards();
  if (cards.length === 0){
    AudioFX.beep("bad");
    openModal("تنبيه", "لم تقم بإضافة بطاقات لعب لهذا اليوم، قم بإضافة بطاقات جديدة وعد غدًا", [
      makeBtn("موافق","btn btn--primary", closeModal)
    ]);
    return;
  }
  checkOverdueModal();
  startLesson();
}

/* =========================
   Export/Import (cloud)
   ========================= */
function exportJSON(){
  const data = JSON.stringify(STATE, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "memorize_game_backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importJSON(file){
  const reader = new FileReader();
  reader.onload = async ()=>{
    try{
      const obj = JSON.parse(reader.result);
      if (!obj.wallet || !obj.cards || !obj.groups) throw new Error("invalid");
      // استيراد كامل (يستبدل)
      STATE = obj;
      await saveUserState(USER.uid, STATE);
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

/* =========================
   Account modal (logout + delete)
   ========================= */
function openAccountModal(){
  openModal("الحساب", `
    <div class="modalRow">
      <div style="font-weight:900">${escapeHTML(STATE.profile?.displayName || USER.displayName || "الحساب")}</div>
      <div class="muted" style="margin-top:6px">${escapeHTML(USER.email || "")}</div>
      <div class="divider"></div>
      <div class="muted">يمكنك تسجيل الخروج أو حذف الحساب نهائيًا.</div>
      <div class="muted tiny">حذف الحساب يؤدي إلى حذف جميع بياناتك من السيرفر.</div>
    </div>
  `, [
    makeBtn(`<span class="material-icons">logout</span> تسجيل الخروج`, "btn btn--primary", async ()=>{
      closeModal();
      await doLogout();
    }),
    makeBtn(`<span class="material-icons">delete</span> حذف الحساب`, "btn btn--danger", ()=>{
      closeModal();
      confirmDeleteAccountStep1();
    })
  ]);
}

function confirmDeleteAccountStep1(){
  openModal("تأكيد", "هل تريد حذف الحساب؟", [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("متابعة","btn btn--danger", ()=>{ closeModal(); confirmDeleteAccountStep2(); })
  ], {closable:false});
}

function confirmDeleteAccountStep2(){
  openModal("تحذير نهائي", "ستفقد جميع بياناتك نهائيًا. هل أنت متأكد؟", [
    makeBtn("إلغاء","btn", closeModal),
    makeBtn("حذف نهائي","btn btn--danger", async ()=>{
      closeModal();
      try{
        await doDeleteAccountHard(auth.currentUser);
      }catch(e){
        // غالبًا يحتاج re-auth
        openModal("يتطلب إعادة تسجيل", `
          <div class="muted">لا يمكن حذف الحساب الآن بسبب حماية الأمان. أدخل كلمة المرور لإعادة التحقق (لحسابات البريد فقط).</div>
          <div class="formGrid one" style="margin-top:12px">
            <div class="field"><label>كلمة المرور</label><input id="reauthPass" type="password" /></div>
          </div>
        `, [
          makeBtn("إلغاء","btn", closeModal),
          makeBtn("متابعة","btn btn--primary", async ()=>{
            const pw = qs("#reauthPass")?.value || "";
            if (!pw) return;
            try{
              await reauthWithPassword(auth.currentUser, pw);
              await doDeleteAccountHard(auth.currentUser);
            }catch{
              closeModal();
              openModal("فشل", "فشل حذف الحساب. أعد تسجيل الدخول ثم حاول مرة أخرى.", [
                makeBtn("حسنًا","btn btn--primary", closeModal)
              ]);
            }
          })
        ], {closable:false});
      }
    })
  ], {closable:false});
}

/* =========================
   Help texts
   ========================= */
const HELP_TEXTS = {
  foreignHelp: "أدخل الكلمة/الجملة باللغة التي تتعلمها. الحقل إلزامي. حد 45 حرف.",
  nativeHelp: "أدخل الترجمة/التوضيح بلغتك. الحقل إلزامي. حد 45 حرف.",
  hintHelp: "أدخل تلميحًا يساعد التذكر (رمز/إيموجي/وصف). الحقل إلزامي. حد 60 حرف."
};

/* =========================
   Wire UI
   ========================= */
function wireUI(){
  qsa(".nav__btn").forEach(b=>{
    b.onclick=()=>{ AudioFX.beep("tap"); showView(b.dataset.view); };
  });

  qs("#btnStartPlay").onclick=()=>{ AudioFX.beep("tap"); handleStartPlay(); };
  qs("#btnQuickAdd").onclick=()=>{ AudioFX.beep("tap"); showView("add"); };

  qs("#btnSaveCard").onclick=()=>{ AudioFX.beep("tap"); saveNewCard(); };
  qs("#btnExitAdd").onclick=()=>{ AudioFX.beep("tap"); confirmExitAddView(); };

  ["#inFront","#inBack","#inHint"].forEach(id=>{
    qs(id).addEventListener("input", ()=>setLockOnAnyInput());
  });

  qs("#view-store").addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-buy]");
    if (!btn) return;
    AudioFX.beep("tap");
    const k = btn.getAttribute("data-buy");
    if (k==="extraCard") await buyExtraCard();
    if (k==="skip") await buySkip();
    if (k==="help") await buyHelp();
    if (k==="fuel") await buyFuel();
  });

  qs("#cardsSearch").addEventListener("input", (e)=>refreshCardsList(e.target.value));
  qs("#btnExport").onclick=()=>{ AudioFX.beep("tap"); exportJSON(); };
  qs("#importFile").addEventListener("change", (e)=>{
    const f=e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value="";
  });

  qs("#btnAbortLesson").onclick=()=>{ AudioFX.beep("tap"); handleAbortLesson(); };
  qs("#btnNextGame").onclick=()=>{ AudioFX.beep("tap"); launchNextGame(); };
  qs("#btnGoHint").onclick=()=>{ AudioFX.beep("tap"); goToHint(); };

  qsa(".qBtn").forEach(b=>{
    b.onclick=()=>{
      AudioFX.beep("tap");
      const key=b.getAttribute("data-help");
      openModal("مساعدة", HELP_TEXTS[key] || "لا توجد.", [
        makeBtn("إغلاق","btn btn--primary", closeModal)
      ]);
    };
  });

  qs("#userBtn").onclick=()=>{ AudioFX.beep("tap"); openAccountModal(); };

  // حماية: إذا أغلق الصفحة أثناء الدرس قبل التلميح -> إلغاء المكافآت
  window.addEventListener("beforeunload", ()=>{
    if (PLAY && !PLAY.completedHintAll){
      cancelLesson();
    }
  });
}

/* =========================
   Cloud sync start
   ========================= */
async function startApp(user){
  USER = user;
  await ensureUserDoc(user);

  if (UNSUB) UNSUB();
  UNSUB = watchUserState(user.uid, async (st)=>{
    STATE = st;

    // ضمان الاسم في state.profile
    STATE.profile = STATE.profile || {};
    STATE.profile.displayName = STATE.profile.displayName || user.displayName || null;
    STATE.profile.email = STATE.profile.email || user.email || null;

    // إصلاح منتصف الليل + الغياب
    advanceCardsUpToToday();

    // ضمان مجموعة اليوم
    getOrCreateTodayGroup();

    // حفظ أي تغييرات حصلت بسبب تقدم الأيام فورًا للسحابة
    await saveUserState(USER.uid, STATE);

    refreshHUD();
    refreshTodayList();
    refreshCardsList(qs("#cardsSearch")?.value || "");

    // إظهار نافذة المتأخرات
    checkOverdueModal();
  });

  wireUI();
  showView("home");
}

/* =========================
   Init
   ========================= */
guardApp(startApp);