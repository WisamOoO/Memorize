// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyCK1j_ILN12Vok3N6it1dgYNphqJVP0axw",
  authDomain: "memorize-game-bb7e8.firebaseapp.com",
  projectId: "memorize-game-bb7e8",
  storageBucket: "memorize-game-bb7e8.firebasestorage.app",
  messagingSenderId: "16321377204",
  appId: "1:16321377204:web:9645129d023710f6b5f8e1",
  measurementId: "G-CK46BP6YJ3"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

export const db = getFirestore(app);

// App Check
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LfC6i8sAAAAAFze6mVK6Ve3erMC3ccdIa8sWsSf"),
  isTokenAutoRefreshEnabled: true
});

// user profile doc
export function userDocRef(uid){
  return doc(db, "users", uid);
}

// state doc (كل بيانات اللعبة داخل Doc واحد لتسهيل الحذف)
export function stateDocRef(uid){
  return doc(db, "users", uid, "app", "state");
}

export async function ensureUserProfileReady(uid){
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) return false;
  const data = snap.data() || {};
  return !!(data.displayName && String(data.displayName).trim());
}

export async function upsertUserProfile(uid, payload){
  await setDoc(userDocRef(uid), {
    ...payload,
    updatedAt: serverTimestamp()
  }, { merge:true });
}

export async function ensureDefaultState(uid, defaultState){
  const ref = stateDocRef(uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const init = {
    ...defaultState,
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, init, { merge:true });
  return init;
}
