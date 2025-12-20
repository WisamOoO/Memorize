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
  doc, getDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot
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

/* ---------------- Default Cloud State ---------------- */
export function defaultCloudState(){
  const today = nowISODateKey();
  return {
    meta: {
      createdAt: Date.now(),
      lastOpenDateKey: today,          // آخر يوم فتح فيه
      lastAttendanceDateKey: null,     // يوم “الحضور” (إنهاء التلميح)
      streak: 0,
      lastActivity: "لا يوجد.",
      addLockDateKey: null,
      resolvedOverdueDateKey: null,    // لمنع تكرار نافذة المتأخرات بنفس اليوم
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
    cards: {},        // {id: card}
    ignoreList: {},   // {id: true}
    profile: { displayName: null, email: null }
  };
}

/* ---------------- Cloud State IO ---------------- */
export function userDocRef(uid){
  return doc(db, "users", uid);
}

export async function ensureUserDoc(user){
  const ref = userDocRef(user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const st = defaultCloudState();
    st.profile.displayName = user.displayName || null;
    st.profile.email = user.email || null;
    await setDoc(ref, {
      state: st,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    // ضمان وجود الحقول الأساسية عند أي تحديث قديم
    const data = snap.data() || {};
    if (!data.state){
      const st = defaultCloudState();
      st.profile.displayName = user.displayName || null;
      st.profile.email = user.email || null;
      await setDoc(ref, { state: st, updatedAt: serverTimestamp() }, { merge: true });
    }
  }
}

export async function saveUserState(uid, state){
  const ref = userDocRef(uid);
  await setDoc(ref, { state, updatedAt: serverTimestamp() }, { merge: true });
}

export function watchUserState(uid, onState){
  const ref = userDocRef(uid);
  return onSnapshot(ref, (snap)=>{
    const data = snap.data();
    if (data?.state) onState(data.state);
  });
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

    // email verification for password users only
    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");

    if (needsName(user)) return redirect("./google-name.html");

    await ensureUserDoc(user);
    redirect("./app.html");
  });
}

export function guardLoginLike(){
  onAuthStateChanged(auth, (user)=>{
    if (!user) return; // stay
    // if logged in already:
    if (isPasswordUser(user) && !user.emailVerified) return redirect("./verify.html");
    if (needsName(user)) return redirect("./google-name.html");
    redirect("./app.html");
  });
}

export function guardVerifyPage(){
  onAuthStateChanged(auth, (user)=>{
    if (!user) return; // allow verify by code
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
  // حذف بيانات Firestore ثم حذف الحساب
  const ref = userDocRef(user.uid);
  await deleteDoc(ref).catch(()=>{});
  await deleteUser(user);
}

export async function reauthWithPassword(user, password){
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
}