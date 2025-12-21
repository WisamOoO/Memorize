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
  doc, getDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot,
  collection, getDocs, writeBatch
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

/* ---------------- Default State (Base doc only) ---------------- */
export function defaultBaseState(){
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
    profile: { displayName: null, email: null }
  };
}

/* ---------------- Refs ---------------- */
export function userDocRef(uid){ return doc(db, "users", uid); }
export function cardsColRef(uid){ return collection(db, "users", uid, "cards"); }
export function groupsColRef(uid){ return collection(db, "users", uid, "groups"); }
export function ignoreColRef(uid){ return collection(db, "users", uid, "ignore"); }

export function cardDocRef(uid, cardId){ return doc(db, "users", uid, "cards", cardId); }
export function groupDocRef(uid, groupId){ return doc(db, "users", uid, "groups", groupId); }
export function ignoreDocRef(uid, cardId){ return doc(db, "users", uid, "ignore", cardId); }

/* ---------------- Ensure user doc ---------------- */
export async function ensureUserDoc(user){
  const ref = userDocRef(user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const base = defaultBaseState();
    base.profile.displayName = user.displayName || null;
    base.profile.email = user.email || null;

    await setDoc(ref, {
      base,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    // create today group doc
    const today = nowISODateKey();
    await setDoc(groupDocRef(user.uid, today), {
      id: today, name: formatGroupName(today), dateKey: today, cardIds: []
    }, { merge: true });

  } else {
    const data = snap.data() || {};
    if (!data.base){
      const base = defaultBaseState();
      base.profile.displayName = user.displayName || null;
      base.profile.email = user.email || null;
      await setDoc(ref, { base, updatedAt: serverTimestamp() }, { merge: true });
    }
  }
}

/* ---------------- Load full state (base + subcollections) ---------------- */
export async function loadFullState(uid){
  const baseSnap = await getDoc(userDocRef(uid));
  const base = (baseSnap.data()?.base) || defaultBaseState();

  const [cardsSnap, groupsSnap, ignoreSnap] = await Promise.all([
    getDocs(cardsColRef(uid)),
    getDocs(groupsColRef(uid)),
    getDocs(ignoreColRef(uid))
  ]);

  const cards = {};
  cardsSnap.forEach(d=>{
    const v = d.data();
    if (v?.id) cards[v.id] = v;
  });

  const groups = {};
  groupsSnap.forEach(d=>{
    const v = d.data();
    if (v?.id) groups[v.id] = v;
  });

  const ignoreList = {};
  ignoreSnap.forEach(d=>{
    ignoreList[d.id] = true;
  });

  return {
    ...base,
    cards,
    groups,
    ignoreList
  };
}

/* ---------------- Watch base only (prevents infinite loops) ---------------- */
export function watchBase(uid, onBase){
  return onSnapshot(userDocRef(uid), (snap)=>{
    const data = snap.data();
    if (data?.base) onBase(data.base);
  });
}

/* ---------------- Save operations ---------------- */
export async function saveBase(uid, base){
  await setDoc(userDocRef(uid), { base, updatedAt: serverTimestamp() }, { merge: true });
}
export async function saveCard(uid, card){
  await setDoc(cardDocRef(uid, card.id), card, { merge: true });
}
export async function deleteCard(uid, cardId){
  await deleteDoc(cardDocRef(uid, cardId));
}
export async function saveGroup(uid, group){
  await setDoc(groupDocRef(uid, group.id), group, { merge: true });
}
export async function setIgnored(uid, cardId, val){
  if (val) await setDoc(ignoreDocRef(uid, cardId), { ignored:true, at: Date.now() }, { merge:true });
  else await deleteDoc(ignoreDocRef(uid, cardId)).catch(()=>{});
}

/* batch helpers */
export async function batchWrite(uid, opsFn){
  const b = writeBatch(db);
  opsFn(b);
  await b.commit();
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
  // NOTE: deleting subcollections is not handled here (needs Cloud Function). Keep as-is for now.
  const ref = userDocRef(user.uid);
  await deleteDoc(ref).catch(()=>{});
  await deleteUser(user);
}
export async function reauthWithPassword(user, password){
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
}
