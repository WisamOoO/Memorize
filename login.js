// login.js
import {
  auth, db,
  onAuthStateChanged,
  setPersistence, browserLocalPersistence,
  googleProvider,
  doc, getDoc, setDoc, serverTimestamp
} from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (s) => document.querySelector(s);
const msg = $("#msg");

function setMsg(t, bad=false){
  msg.textContent = t || "";
  msg.style.color = bad ? "#EF4444" : "";
}

await setPersistence(auth, browserLocalPersistence);

// إن كان مسجل دخول مسبقًا
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  if (!user.emailVerified) {
    window.location.replace("verify.html");
    return;
  }
  window.location.replace("app.html");
});

$("#btnLogin").onclick = async () => {
  setMsg("");
  const email = $("#email").value.trim();
  const pass = $("#pass").value;

  if (!email || !pass) {
    setMsg("أدخل البريد وكلمة المرور.", true);
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);

    if (!cred.user.emailVerified) {
      window.location.replace("verify.html");
      return;
    }

    // تأكد من وجود وثيقة المستخدم
    const uref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(uref);
    if (!snap.exists()) {
      await setDoc(uref, {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || "مستخدم",
        createdAt: serverTimestamp(),
        state: null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    window.location.replace("app.html");
  } catch (e) {
    setMsg("فشل تسجيل الدخول. تحقق من البيانات.", true);
  }
};

$("#btnGoogle").onclick = async () => {
  setMsg("");
  try{
    const cred = await signInWithPopup(auth, googleProvider);

    const uref = doc(db, "users", cred.user.uid);
    const snap = await getDoc(uref);

    // إذا أول مرة أو ما في اسم: روح لصفحة الاسم
    if (!snap.exists() || !(snap.data()?.displayName) || snap.data()?.displayName === "مستخدم") {
      await setDoc(uref, {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: snap.exists() ? (snap.data().displayName || "مستخدم") : "مستخدم",
        createdAt: snap.exists() ? (snap.data().createdAt || serverTimestamp()) : serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      window.location.replace("google-name.html");
      return;
    }

    window.location.replace("app.html");
  }catch(e){
    setMsg("فشل تسجيل الدخول عبر Google.", true);
  }
};