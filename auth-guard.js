// auth-guard.js
import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  getDocs,
  writeBatch,
  updateDoc,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- Helpers ---------------- */
export function qs(sel){ return document.querySelector(sel); }
export function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

export function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

export function nowISODateKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}
export function formatGroupName(dateKey){
  const [y,m,d] = dateKey.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
export function parseDateKey(dateKey){
  const [y,m,d] = dateKey.split("-").map(Number);
  return new Date(y, m-1, d);
}
export function addDays(dateKey, n){
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate()+n);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}
export function daysBetween(aKey, bKey){
  const a = parseDateKey(aKey);
  const b = parseDateKey(bKey);
  return Math.floor((b-a)/(1000*60*60*24));
}

export const TIERS = ["خشبي","حديدي","نحاسي","فضي","ذهبي","زمردي","بلاتيني","ألماسي","أستاذ","مفكر","حكيم","ملهم"];
export const DUE_LEVELS = new Set([1,3,6,7]);

export function tierMaxSub(tierIdx){
  if (tierIdx <= 6) return 3;
  if (tierIdx === 7) return 4;
  if (tierIdx === 8) return 5;
  if (tierIdx === 9) return 6;
  if (tierIdx === 10) return 7;
  return 999999;
}
export function targetProgressForRank(tierIdx, subLevel){
  if (tierIdx <= 6) return 120 + (30*tierIdx) + (15*(subLevel-1));
  if (tierIdx === 7) return 400 + (40*(subLevel-1));
  if (tierIdx === 8) return 600 + (60*(subLevel-1));
  if (tierIdx === 9) return 900 + (90*(subLevel-1));
  if (tierIdx === 10) return 1400 + (120*(subLevel-1));
  return 2200 + (100*(subLevel-1));
}

export function difficultyD(rank){
  const R = rank.tierIndex;
  const S = rank.subLevel;
  return 1 + (0.12*R) + (0.04*(S-1));
}
export function levelMultiplier(level){
  const map = {0:0.80,1:1.00,2:1.10,3:1.25,4:1.40,5:1.60,6:1.85,7:2.20};
  return map[level] ?? 1.00;
}
export function speedFactor(sec){
  if (sec <= 2.0) return 1.30;
  if (sec <= 4.0) return 1.15;
  if (sec <= 7.0) return 1.00;
  if (sec <= 12.0) return 0.80;
  return 0.60;
}
export function accountLevelFromXP(xp){
  const lvl = Math.floor(Math.sqrt(Math.max(0,xp)/500))+1;
  const curMinXP = (Math.max(0,(lvl-1))**2)*500;
  const nextMinXP = (lvl**2)*500;
  return {level:lvl, curMinXP, nextMinXP, toNext: Math.max(0,nextMinXP-xp)};
}

/* ---------------- Refs (split storage) ---------------- */
export function userDocRef(uid){ return doc(db, "users", uid); }
export function cardsColRef(uid){ return collection(db, "users", uid, "cards"); }
export function groupsColRef(uid){ return collection(db, "users", uid, "groups"); }
export function ignoreColRef(uid){ return collection(db, "users", uid, "ignore"); }

export function cardDocRef(uid, cardId){ return doc(db, "users", uid, "cards", cardId); }
export function groupDocRef(uid, groupId){ return doc(db, "users", uid, "groups", groupId); }
export function ignoreDocRef(uid, cardId){ return doc(db, "users", uid, "ignore", cardId); }

/* ---------------- Default State (logical) ---------------- */
export function defaultCloudState(){
  const today = nowISODateKey();
  return {
    meta: {
      createdAt: Date.now(),
      lastOpenDateKey: today,
      lastAttendanceDateKey: null,
      streak: 0,
      lastActivity: "لا يوجد.",
      addLockDateKey: null,
      resolvedOverdueDateKey: null,
    },
    wallet: { gold: 900, xp: 0 },
    rank: { tierIndex: 0, subLevel: 1, progress: 0 },
    inventory: {
      dateKey: today,
      extraCardsBought: 0,
      extraCardsUsed: 0,
      skip: 0,
      help: 0,
      fuel: 0
    },
    groups: {
      [today]: { id: today, name: formatGroupName(today), dateKey: today, cardIds: [] }
    },
    cards: {},
    ignoreList: {},
    profile: { displayName: null, email: null }
  };
}

/* ---------------- Chunk helpers ---------------- */
function chunkArray(arr, size=450){
  const out=[];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size));
  return out;
}

/* ---------------- Migration + Ensure ----------------
   v1: /users/{uid} { state: {meta,wallet,rank,inventory,groups,cards,ignoreList,profile} }
   v2: /users/{uid} { schemaVersion:2, meta,wallet,rank,inventory,profile }
       subcollections: cards, groups, ignore
*/
export async function ensureUserDoc(user){
  const ref = userDocRef(user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()){
    const st = defaultCloudState();
    st.profile.displayName = user.displayName || null;
    st.profile.email = user.email || null;

    // root doc (light)
    await setDoc(ref, {
      schemaVersion: 2,
      meta: st.meta,
      wallet: st.wallet,
      rank: st.rank,
      inventory: st.inventory,
      profile: st.profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // create today group doc
    const today = nowISODateKey();
    await setDoc(groupDocRef(user.uid, today), st.groups[today], { merge: true });

    return;
  }

  const data = snap.data() || {};

  // Migration needed
  if (data?.state && !data?.schemaVersion){
    const old = data.state;
    const st = defaultCloudState();

    st.meta = old.meta || st.meta;
    st.wallet = old.wallet || st.wallet;
    st.rank = old.rank || st.rank;
    st.inventory = old.inventory || st.inventory;
    st.profile = old.profile || st.profile;
    st.profile.displayName = st.profile.displayName || user.displayName || null;
    st.profile.email = st.profile.email || user.email || null;

    // write root doc
    await setDoc(ref, {
      schemaVersion: 2,
      meta: st.meta,
      wallet: st.wallet,
      rank: st.rank,
      inventory: st.inventory,
      profile: st.profile,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // write subcollections in batches
    const uid = user.uid;

    const cards = Object.values(old.cards || {});
    const groups = Object.values(old.groups || {});
    const ignoreKeys = Object.keys(old.ignoreList || {});

    for (const part of chunkArray(cards, 450)){
      const batch = writeBatch(db);
      part.forEach(c=>{
        if (!c?.id) return;
        batch.set(cardDocRef(uid, c.id), c, { merge: true });
      });
      await batch.commit();
    }

    for (const part of chunkArray(groups, 450)){
      const batch = writeBatch(db);
      part.forEach(g=>{
        if (!g?.id) return;
        batch.set(groupDocRef(uid, g.id), g, { merge: true });
      });
      await batch.commit();
    }

    for (const part of chunkArray(ignoreKeys, 450)){
      const batch = writeBatch(db);
      part.forEach(id=>{
        batch.set(ignoreDocRef(uid, id), { id, ignored: true, updatedAt: Date.now() }, { merge: true });
      });
      await batch.commit();
    }

    // remove old big field
    await updateDoc(ref, { state: deleteField(), updatedAt: serverTimestamp() }).catch(()=>{});
    return;
  }

  // ensure essential fields exist
  const patch = {};
  let needPatch=false;

  if (!data.schemaVersion){ patch.schemaVersion = 2; needPatch=true; }
  if (!data.meta){ patch.meta = defaultCloudState().meta; needPatch=true; }
  if (!data.wallet){ patch.wallet = defaultCloudState().wallet; needPatch=true; }
  if (!data.rank){ patch.rank = defaultCloudState().rank; needPatch=true; }
  if (!data.inventory){ patch.inventory = defaultCloudState().inventory; needPatch=true; }
  if (!data.profile){
    patch.profile = { displayName: user.displayName || null, email: user.email || null };
    needPatch=true;
  } else {
    // keep profile consistent
    const p = data.profile || {};
    const upd = {};
    if (!p.displayName && user.displayName){ upd["profile.displayName"] = user.displayName; needPatch=true; }
    if (!p.email && user.email){ upd["profile.email"] = user.email; needPatch=true; }
    Object.assign(patch, upd);
  }

  if (needPatch){
    patch.updatedAt = serverTimestamp();
    await setDoc(ref, patch, { merge: true });
  }

  // ensure today group exists
  const today = nowISODateKey();
  await setDoc(groupDocRef(user.uid, today), { id: today, name: formatGroupName(today), dateKey: today, cardIds: [] }, { merge: true });
}

/* ---------------- Split Saves ---------------- */
export async function saveMeta(uid, partial){
  await setDoc(userDocRef(uid), { ...partial, updatedAt: serverTimestamp() }, { merge: true });
}

export async function saveCard(uid, card){
  await setDoc(cardDocRef(uid, card.id), card, { merge: true });
}
export async function saveCardsBatch(uid, cards){
  const list = (cards || []).filter(c=>c?.id);
  if (!list.length) return;
  for (const part of chunkArray(list, 450)){
    const batch = writeBatch(db);
    part.forEach(c=> batch.set(cardDocRef(uid, c.id), c, { merge: true }));
    await batch.commit();
  }
}

export async function deleteCardsBatch(uid, cardIds){
  const ids = (cardIds || []).filter(Boolean);
  if (!ids.length) return;
  for (const part of chunkArray(ids, 450)){
    const batch = writeBatch(db);
    part.forEach(id=> batch.delete(cardDocRef(uid, id)));
    await batch.commit();
  }
}

export async function saveGroup(uid, group){
  await setDoc(groupDocRef(uid, group.id), group, { merge: true });
}
export async function saveGroupsBatch(uid, groups){
  const list = (groups || []).filter(g=>g?.id);
  if (!list.length) return;
  for (const part of chunkArray(list, 450)){
    const batch = writeBatch(db);
    part.forEach(g=> batch.set(groupDocRef(uid, g.id), g, { merge: true }));
    await batch.commit();
  }
}

export async function setIgnored(uid, cardId, ignored){
  if (ignored){
    await setDoc(ignoreDocRef(uid, cardId), { id: cardId, ignored: true, updatedAt: Date.now() }, { merge: true });
  } else {
    await deleteDoc(ignoreDocRef(uid, cardId)).catch(()=>{});
  }
}
export async function setIgnoredBatch(uid, cardIds, ignored){
  const ids = (cardIds || []).filter(Boolean);
  if (!ids.length) return;
  for (const part of chunkArray(ids, 450)){
    const batch = writeBatch(db);
    part.forEach(id=>{
      const r = ignoreDocRef(uid, id);
      if (ignored) batch.set(r, { id, ignored: true, updatedAt: Date.now() }, { merge: true });
      else batch.delete(r);
    });
    await batch.commit();
  }
}

/* Full save for import/export (replace or merge) */
export async function saveUserState(uid, state, opts={ mode:"replace" }){
  const mode = opts?.mode || "replace";

  // root
  const root = {
    schemaVersion: 2,
    meta: state.meta,
    wallet: state.wallet,
    rank: state.rank,
    inventory: state.inventory,
    profile: state.profile
  };
  await setDoc(userDocRef(uid), { ...root, updatedAt: serverTimestamp() }, { merge: true });

  const cardsMap = state.cards || {};
  const groupsMap = state.groups || {};
  const ignoreMap = state.ignoreList || {};

  const cardIdsNew = new Set(Object.keys(cardsMap));
  const groupIdsNew = new Set(Object.keys(groupsMap));
  const ignoreIdsNew = new Set(Object.keys(ignoreMap));

  if (mode === "replace"){
    // delete removed docs
    const [cardsSnap, groupsSnap, ignoreSnap] = await Promise.all([
      getDocs(cardsColRef(uid)),
      getDocs(groupsColRef(uid)),
      getDocs(ignoreColRef(uid))
    ]);

    const delCards = [];
    cardsSnap.forEach(d=>{ if (!cardIdsNew.has(d.id)) delCards.push(d.id); });
    const delGroups = [];
    groupsSnap.forEach(d=>{ if (!groupIdsNew.has(d.id)) delGroups.push(d.id); });
    const delIgnore = [];
    ignoreSnap.forEach(d=>{ if (!ignoreIdsNew.has(d.id)) delIgnore.push(d.id); });

    await deleteCardsBatch(uid, delCards);

    if (delGroups.length){
      for (const part of chunkArray(delGroups, 450)){
        const batch = writeBatch(db);
        part.forEach(id=> batch.delete(groupDocRef(uid, id)));
        await batch.commit();
      }
    }

    if (delIgnore.length){
      for (const part of chunkArray(delIgnore, 450)){
        const batch = writeBatch(db);
        part.forEach(id=> batch.delete(ignoreDocRef(uid, id)));
        await batch.commit();
      }
    }
  }

  // upsert new docs
  await saveCardsBatch(uid, Object.values(cardsMap));
  await saveGroupsBatch(uid, Object.values(groupsMap));

  const ignoreIds = Object.keys(ignoreMap || {});
  await setIgnoredBatch(uid, ignoreIds, true);
}

/* ---------------- Watch (composed state) ---------------- */
export function watchUserState(uid, onState){
  const metaRef = userDocRef(uid);

  let meta = null;
  const cards = {};
  const groups = {};
  const ignoreList = {};

  let metaReady=false, cardsReady=false, groupsReady=false, ignoreReady=false;

  const emit = ()=>{
    if (!metaReady) return;
    if (!cardsReady || !groupsReady || !ignoreReady) return;
    onState({
      meta: meta.meta,
      wallet: meta.wallet,
      rank: meta.rank,
      inventory: meta.inventory,
      profile: meta.profile,
      cards: { ...cards },
      groups: { ...groups },
      ignoreList: { ...ignoreList }
    });
  };

  const unsubMeta = onSnapshot(metaRef, (snap)=>{
    const d = snap.data() || {};

    // fallback for legacy (should be migrated by ensureUserDoc)
    if (d.state){
      meta = d.state;
      metaReady=true;
      emit();
      return;
    }

    meta = {
      meta: d.meta || defaultCloudState().meta,
      wallet: d.wallet || defaultCloudState().wallet,
      rank: d.rank || defaultCloudState().rank,
      inventory: d.inventory || defaultCloudState().inventory,
      profile: d.profile || { displayName:null, email:null }
    };
    metaReady=true;
    emit();
  });

  const unsubCards = onSnapshot(cardsColRef(uid), (snap)=>{
    snap.docChanges().forEach(ch=>{
      const id = ch.doc.id;
      if (ch.type === "removed") delete cards[id];
      else cards[id] = ch.doc.data();
    });
    cardsReady=true;
    emit();
  });

  const unsubGroups = onSnapshot(groupsColRef(uid), (snap)=>{
    snap.docChanges().forEach(ch=>{
      const id = ch.doc.id;
      if (ch.type === "removed") delete groups[id];
      else groups[id] = ch.doc.data();
    });
    groupsReady=true;
    emit();
  });

  const unsubIgnore = onSnapshot(ignoreColRef(uid), (snap)=>{
    snap.docChanges().forEach(ch=>{
      const id = ch.doc.id;
      if (ch.type === "removed") delete ignoreList[id];
      else {
        const v = ch.doc.data();
        if (v?.ignored) ignoreList[id] = true;
      }
    });
    ignoreReady=true;
    emit();
  });

  return ()=>{ unsubMeta(); unsubCards(); unsubGroups(); unsubIgnore(); };
}

/* ---------------- Auth Gates ---------------- */
export function isPasswordUser(user){
  return (user?.providerData || []).some(p => p.providerId === "password");
}
export function needsName(user){
  return !user?.displayName || !String(user.displayName).trim();
}

export function redirect(path){
  window.location.replace(path);
}

export function guardIndex(){
  onAuthStateChanged(auth, async (user)=>{
    if (!user) return redirect("./login.html");

    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");
    if (needsName(user)) return redirect("./google-name.html");

    await ensureUserDoc(user);
    redirect("./app.html");
  });
}

export function guardLoginLike(){
  onAuthStateChanged(auth, (user)=>{
    if (!user) return;
    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");
    if (needsName(user)) return redirect("./google-name.html");
    redirect("./app.html");
  });
}

export function guardVerifyPage(){
  onAuthStateChanged(auth, (user)=>{
    if (!user) return;
  });
}

export function guardGoogleNamePage(){
  onAuthStateChanged(auth, (user)=>{
    if (!user) return redirect("./login.html");
    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");
    if (!needsName(user)) return redirect("./app.html");
  });
}

export function guardApp(onUser){
  onAuthStateChanged(auth, async (user)=>{
    if (!user) return redirect("./login.html");
    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");
    if (needsName(user)) return redirect("./google-name.html");
    await ensureUserDoc(user);
    onUser(user);
  });
}

/* ---------------- Account Actions ---------------- */
export async function doLogout(){
  await signOut(auth);
  redirect("./login.html");
}

export async function doDeleteAccountHard(user){
  // WARNING: deletes only root doc; subcollections remain unless you delete them server-side.
  // (Firestore لا يحذف subcollections تلقائيًا)
  const ref = userDocRef(user.uid);
  await deleteDoc(ref).catch(()=>{});
  await deleteUser(user);
}

export async function reauthWithPassword(user, password){
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
}
