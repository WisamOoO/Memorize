// firebase.js (ESM)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyCK1j_ILN12Vok3N6it1dgYNphqJVP0axw",
  authDomain: "memorize-game-bb7e8.firebaseapp.com",
  projectId: "memorize-game-bb7e8",
  storageBucket: "memorize-game-bb7e8.firebasestorage.app",
  messagingSenderId: "16321377204",
  appId: "1:16321377204:web:9645129d023710f6b5f8e1",
  measurementId: "G-CK46BP6YJ3"
};

export const app = initializeApp(firebaseConfig);

// App Check (ReCaptcha v3)
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LfC6i8sAAAAAFze6mVK6Ve3erMC3ccdIa8sWsSf"),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const db = getFirestore(app);

export { onAuthStateChanged, setPersistence, browserLocalPersistence };
export const googleProvider = new GoogleAuthProvider();

export { doc, getDoc, setDoc, deleteDoc, serverTimestamp };