/* auth.js (shared for auth pages) */

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
  applyActionCode,
  reload,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

/* ---------- Your Firebase Config ---------- */
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

const app = initializeApp(firebaseConfig);
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- Simple modal ---------- */
const host = document.getElementById("modalHost");
function openModal(title, html, buttons = []) {
  if (!host) return alert(title + "\n" + html.replace(/<[^>]*>/g," "));
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `
    <div class="modal__head">
      <h3>${escapeHTML(title)}</h3>
      <button class="btn btn--small btn--ghost" id="mClose">
        <span class="material-icons">close</span> إغلاق
      </button>
    </div>
    <div>${html}</div>
    <div class="rowActions" style="margin-top:12px" id="mBtns"></div>
  `;
  host.appendChild(wrap);
  host.classList.add("show");
  wrap.querySelector("#mClose").onclick = closeModal;
  host.onclick = (e)=>{ if(e.target===host) closeModal(); };
  const btns = wrap.querySelector("#mBtns");
  buttons.forEach(b => btns.appendChild(b));
}
function closeModal() {
  if (!host) return;
  host.classList.remove("show");
  host.innerHTML = "";
}
function makeBtn(text, cls, onClick){
  const b = document.createElement("button");
  b.className = cls;
  b.type = "button";
  b.innerHTML = text;
  b.onclick = onClick;
  return b;
}
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ---------- Profile doc helpers ---------- */
function profileRef(uid){ return doc(db, "users", uid, "private", "profile"); }

async function ensureProfile(uid, data){
  const ref = profileRef(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, { ...data, createdAt: serverTimestamp() }, { merge:true });
  } else {
    await setDoc(ref, { ...data }, { merge:true });
  }
}

function isSequentialNumbers(pass){
  const digits = pass.replace(/\D/g,"");
  if (digits.length < 4) return false;
  const s = digits;
  for (let i=0;i<=s.length-4;i++){
    const a = s[i], b = s[i+1], c = s[i+2], d = s[i+3];
    if (+b===+a+1 && +c===+b+1 && +d===+c+1) return true;  // 1234
    if (a===b && b===c && c===d) return true;              // 0000
  }
  return false;
}

function page(){
  const p = location.pathname.split("/").pop().toLowerCase();
  return p || "index.html";
}

/* ---------- Routing guards ---------- */
onAuthStateChanged(auth, async (user) => {
  const p = page();

  // APP page is guarded in app.js, not here
  if (p === "app.html") return;

  // If already logged in:
  if (user) {
    // Email/password requires verification
    const hasPasswordProvider = (user.providerData || []).some(x => x.providerId === "password");
    if (hasPasswordProvider) {
      await reload(user);
      if (!user.emailVerified) {
        // stay on auth pages
        return;
      }
    }

    // Check profile name
    const prof = await getDoc(profileRef(user.uid));
    const name = prof.exists() ? (prof.data().name || "") : "";
    if (!name) {
      if (p !== "profile.html") location.href = "profile.html";
      return;
    }

    // if on login/signup/reset/verify -> go app
    if (["index.html","signup.html","reset.html","verify.html","profile.html"].includes(p)) {
      location.href = "app.html";
    }
  }
});

/* ---------- Page actions ---------- */
const p = page();

/* LOGIN */
if (p === "index.html") {
  const msg = document.getElementById("loginMsg");
  const email = document.getElementById("loginEmail");
  const pass = document.getElementById("loginPass");

  document.getElementById("btnGoSignup")?.addEventListener("click", ()=> location.href="signup.html");
  document.getElementById("btnGoReset")?.addEventListener("click", ()=> location.href="reset.html");

  document.getElementById("btnLogin")?.addEventListener("click", async ()=>{
    msg.textContent = "—";
    try{
      const e = (email.value||"").trim();
      const p = pass.value || "";
      const cred = await signInWithEmailAndPassword(auth, e, p);

      const hasPasswordProvider = (cred.user.providerData||[]).some(x=>x.providerId==="password");
      if (hasPasswordProvider) {
        await reload(cred.user);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          openModal("الحساب غير مؤكد", `
            <div class="modalRow">
              <div class="muted">تم إرسال رسالة تأكيد عند إنشاء الحساب. يجب تأكيد البريد قبل الدخول.</div>
            </div>
          `, [
            makeBtn(`<span class="material-icons">mail</span> إعادة إرسال`, "btn btn--primary", async ()=>{
              closeModal();
              // re-login temporarily to send verify
              const c2 = await signInWithEmailAndPassword(auth, e, p);
              await sendEmailVerification(c2.user, { url: location.origin + "/verify.html" });
              await signOut(auth);
              msg.textContent = "تم إرسال رسالة التأكيد مرة أخرى.";
            }),
            makeBtn("حسنًا","btn", closeModal)
          ]);
          return;
        }
      }

      // check profile name
      const prof = await getDoc(profileRef(cred.user.uid));
      const name = prof.exists() ? (prof.data().name || "") : "";
      if (!name) {
        location.href = "profile.html";
        return;
      }

      location.href = "app.html";
    }catch(err){
      msg.textContent = "فشل تسجيل الدخول. تأكد من البريد وكلمة المرور.";
    }
  });

  document.getElementById("btnGoogle")?.addEventListener("click", async ()=>{
    msg.textContent = "—";
    try{
      const prov = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, prov);
      // if no profile name -> go profile page
      const prof = await getDoc(profileRef(cred.user.uid));
      const name = prof.exists() ? (prof.data().name || "") : "";
      if (!name) {
        location.href = "profile.html";
        return;
      }
      location.href = "app.html";
    }catch(e){
      msg.textContent = "فشل تسجيل الدخول عبر Google.";
    }
  });
}

/* SIGNUP */
if (p === "signup.html") {
  const msg = document.getElementById("suMsg");
  document.getElementById("btnBackLogin")?.addEventListener("click", ()=> location.href="index.html");

  document.getElementById("btnSignup")?.addEventListener("click", async ()=>{
    msg.textContent = "—";
    try{
      const name = (document.getElementById("suName").value||"").trim();
      const email = (document.getElementById("suEmail").value||"").trim();
      const p1 = document.getElementById("suPass1").value || "";
      const p2 = document.getElementById("suPass2").value || "";

      if (!name || name.length < 2) { msg.textContent = "الاسم مطلوب (حرفين على الأقل)."; return; }
      if (!email) { msg.textContent = "البريد مطلوب."; return; }
      if (p1.length < 8) { msg.textContent = "كلمة المرور يجب أن تكون 8 خانات على الأقل."; return; }
      if (p1 !== p2) { msg.textContent = "كلمتا المرور غير متطابقتين."; return; }
      if (isSequentialNumbers(p1)) { msg.textContent = "كلمة المرور ضعيفة (أرقام متتالية/مكررة)."; return; }

      const cred = await createUserWithEmailAndPassword(auth, email, p1);
      await updateProfile(cred.user, { displayName: name });
      await ensureProfile(cred.user.uid, { name });

      await sendEmailVerification(cred.user, { url: location.origin + "/verify.html" });
      await signOut(auth);

      openModal("تم إنشاء الحساب", `
        <div class="modalRow">
          <div style="font-weight:900">تم إرسال رسالة تأكيد إلى بريدك.</div>
          <div class="muted" style="margin-top:8px">بعد التأكيد ارجع وسجّل دخولك.</div>
        </div>
      `, [
        makeBtn(`<span class="material-icons">login</span> تسجيل الدخول`, "btn btn--primary", ()=> location.href="index.html")
      ]);
    }catch(e){
      msg.textContent = "فشل إنشاء الحساب. ربما البريد مستخدم مسبقًا.";
    }
  });
}

/* RESET PASSWORD */
if (p === "reset.html") {
  const msg = document.getElementById("rsMsg");
  document.getElementById("btnBackLogin2")?.addEventListener("click", ()=> location.href="index.html");

  document.getElementById("btnSendReset")?.addEventListener("click", async ()=>{
    msg.textContent = "—";
    try{
      const email = (document.getElementById("rsEmail").value||"").trim();
      if (!email) { msg.textContent = "أدخل البريد."; return; }
      await sendPasswordResetEmail(auth, email);
      msg.textContent = "تم إرسال رابط تغيير كلمة المرور.";
    }catch(e){
      msg.textContent = "فشل الإرسال. تأكد من البريد.";
    }
  });
}

/* VERIFY PAGE (from email link) */
if (p === "verify.html") {
  const m = document.getElementById("vfMsg");
  document.getElementById("btnToLogin")?.addEventListener("click", ()=> location.href="index.html");

  (async ()=>{
    try{
      const params = new URLSearchParams(location.search);
      const mode = params.get("mode");
      const oobCode = params.get("oobCode");

      if (mode === "verifyEmail" && oobCode) {
        await applyActionCode(auth, oobCode);
        m.textContent = "تم تأكيد البريد بنجاح. يمكنك الآن تسجيل الدخول.";
        setTimeout(()=> location.href="index.html", 1200);
        return;
      }
      m.textContent = "الرابط غير صالح أو منتهي.";
    }catch(e){
      m.textContent = "فشل التأكيد. ربما الرابط منتهي.";
    }
  })();
}

/* PROFILE (name after Google) */
if (p === "profile.html") {
  const msg = document.getElementById("pfMsg");

  document.getElementById("btnLogoutHere")?.addEventListener("click", async ()=>{
    await signOut(auth);
    location.href = "index.html";
  });

  document.getElementById("btnSaveName")?.addEventListener("click", async ()=>{
    msg.textContent = "—";
    const user = auth.currentUser;
    if (!user) { location.href="index.html"; return; }

    const name = (document.getElementById("pfName").value||"").trim();
    if (!name || name.length < 2) { msg.textContent = "الاسم مطلوب (حرفين على الأقل)."; return; }

    try{
      await updateProfile(user, { displayName: name });
      await ensureProfile(user.uid, { name });
      location.href = "app.html";
    }catch(e){
      msg.textContent = "فشل حفظ الاسم.";
    }
  });
}
