/* auth.js (ESM) */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

/* Firebase Config */
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
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (s) => document.querySelector(s);

/* Modal (same style host) */
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

function msg(t){ $("#authMsg").textContent = t || "—"; }

/* UI switches */
function showLogin(){
  $("#authTitle").textContent = "تسجيل الدخول";
  $("#loginBox").style.display = "";
  $("#registerBox").style.display = "none";
  $("#resetBox").style.display = "none";
  $("#verifyBox").style.display = "none";
  msg("—");
}
function showRegister(){
  $("#authTitle").textContent = "إنشاء حساب";
  $("#loginBox").style.display = "none";
  $("#registerBox").style.display = "";
  $("#resetBox").style.display = "none";
  $("#verifyBox").style.display = "none";
  msg("—");
}
function showReset(){
  $("#authTitle").textContent = "استعادة كلمة المرور";
  $("#loginBox").style.display = "none";
  $("#registerBox").style.display = "none";
  $("#resetBox").style.display = "";
  $("#verifyBox").style.display = "none";
  msg("—");
}
function showVerifyGate(){
  $("#verifyBox").style.display = "";
}

/* Password rules (بدون إلزام رموز) */
function isSequentialDigits(p) {
  // يمنع 3 أرقام متتالية صاعدة أو نازلة داخل كلمة المرور
  const digits = p.replace(/[^\d]/g,"");
  if (digits.length < 3) return false;
  for (let i=0;i<=digits.length-3;i++){
    const a = +digits[i], b = +digits[i+1], c = +digits[i+2];
    if (b === a+1 && c === b+1) return true;
    if (b === a-1 && c === b-1) return true;
  }
  return false;
}
function validatePassword(p) {
  if ((p||"").length < 8) return "كلمة المرور يجب ألا تقل عن 8 أحرف.";
  if (/\s/.test(p)) return "كلمة المرور لا يجب أن تحتوي فراغات.";
  if (!/[A-Za-z\u0600-\u06FF]/.test(p)) return "يفضّل وجود حروف داخل كلمة المرور.";
  if (!/\d/.test(p)) return "يفضّل وجود أرقام داخل كلمة المرور.";
  if (isSequentialDigits(p)) return "تجنّب الأرقام المتتالية داخل كلمة المرور.";
  if (/^(.)\1+$/.test(p)) return "لا تستخدم نفس الحرف مكررًا فقط.";
  return null;
}

/* Firestore profile */
async function ensureUserProfile(uid, displayName) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: displayName || "لاعب",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    }, { merge: true });
  } else {
    await setDoc(ref, { lastLoginAt: serverTimestamp() }, { merge: true });
  }
}
async function getProfile(uid){
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

/* Google: require name first time */
async function askNameIfMissing(user){
  const prof = await getProfile(user.uid);
  const currentName = prof?.displayName || user.displayName || "";

  if (currentName && currentName.trim().length >= 2) {
    await ensureUserProfile(user.uid, currentName.trim());
    return currentName.trim();
  }

  return new Promise((resolve, reject) => {
    openModal("اسم الحساب", `
      <div class="modalRow">
        <div style="font-weight:900">قبل دخولك للتطبيق، اكتب الاسم الذي سيظهر داخل اللعبة.</div>
        <div class="divider"></div>
        <div class="field">
          <label>الاسم</label>
          <input id="namePick" maxlength="30" placeholder="مثال: محمود" style="width:100%;margin-top:10px" />
          <div class="field__sub">حد أقصى 30 حرف</div>
        </div>
      </div>
    `, [
      makeBtn("إلغاء", "btn", () => { closeModal(); reject(new Error("cancel")); }),
      makeBtn("حفظ", "btn btn--primary", async () => {
        const v = (document.querySelector("#namePick")?.value || "").trim();
        if (v.length < 2) return;
        try{
          await updateProfile(user, { displayName: v });
        }catch{}
        await ensureUserProfile(user.uid, v);
        closeModal();
        resolve(v);
      })
    ], { closable:false });
  });
}

/* Actions */
async function doGoogle(){
  msg("جارٍ تسجيل الدخول عبر Google...");
  try{
    const provider = new GoogleAuthProvider();
    const res = await signInWithPopup(auth, provider);
    const user = res.user;
    await askNameIfMissing(user);
    location.href = "app.html";
  }catch(e){
    msg("فشل تسجيل الدخول عبر Google.");
  }
}

async function doRegister(){
  const name = ($("#regName").value || "").trim();
  const email = ($("#regEmail").value || "").trim();
  const pass = $("#regPass").value || "";
  const pass2 = $("#regPass2").value || "";

  if (name.length < 2) return msg("الاسم مطلوب (حرفين على الأقل).");
  if (!email) return msg("البريد الإلكتروني مطلوب.");
  if (!pass || !pass2) return msg("كلمة المرور وتأكيدها مطلوبان.");
  if (pass !== pass2) return msg("كلمتا المرور غير متطابقتين.");

  const err = validatePassword(pass);
  if (err) return msg(err);

  msg("جارٍ إنشاء الحساب...");
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const user = cred.user;

    try{ await updateProfile(user, { displayName: name }); }catch{}
    await ensureUserProfile(user.uid, name);

    await sendEmailVerification(user);
    msg("تم إرسال رابط التأكيد. أكمل التفعيل أولًا.");
    showVerifyGate();
  }catch(e){
    msg("تعذر إنشاء الحساب. تأكد من البريد أو جرّب كلمة مرور مختلفة.");
  }
}

async function doLogin(){
  const email = ($("#loginEmail").value || "").trim();
  const pass = $("#loginPass").value || "";
  if (!email || !pass) return msg("البريد وكلمة المرور مطلوبان.");

  msg("جارٍ تسجيل الدخول...");
  try{
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const user = cred.user;

    if (!user.emailVerified) {
      msg("الحساب غير مُؤكد. تم منع الدخول حتى تفعيل البريد.");
      showVerifyGate();
      return;
    }

    const prof = await getProfile(user.uid);
    const dn = prof?.displayName || user.displayName || "لاعب";
    await ensureUserProfile(user.uid, dn);

    location.href = "app.html";
  }catch(e){
    msg("بيانات الدخول غير صحيحة.");
  }
}

async function doReset(){
  const email = ($("#resetEmail").value || "").trim();
  if (!email) return msg("أدخل البريد الإلكتروني.");
  msg("جارٍ الإرسال...");
  try{
    await sendPasswordResetEmail(auth, email);
    msg("تم إرسال رابط تغيير كلمة المرور إلى بريدك.");
  }catch(e){
    msg("تعذر الإرسال. تأكد من البريد الإلكتروني.");
  }
}

async function resendVerify(){
  const user = auth.currentUser;
  if (!user) return;
  try{
    await sendEmailVerification(user);
    msg("تمت إعادة إرسال رابط التأكيد.");
  }catch{
    msg("تعذر إعادة الإرسال حاليًا.");
  }
}

async function checkVerified(){
  const user = auth.currentUser;
  if (!user) return;
  try{
    await user.reload();
    if (auth.currentUser?.emailVerified) {
      const prof = await getProfile(user.uid);
      const dn = prof?.displayName || user.displayName || "لاعب";
      await ensureUserProfile(user.uid, dn);
      location.href = "app.html";
    } else {
      msg("لم يتم تأكيد البريد بعد.");
    }
  }catch{
    msg("تعذر التحقق الآن.");
  }
}

async function logout(){
  try{ await signOut(auth); }catch{}
  msg("تم تسجيل الخروج.");
  showLogin();
}

/* Wiring */
$("#btnGoogle").onclick = doGoogle;

$("#btnGoRegister").onclick = showRegister;
$("#btnGoLogin1").onclick = showLogin;
$("#btnGoLogin2").onclick = showLogin;
$("#btnGoReset").onclick = showReset;

$("#btnRegister").onclick = doRegister;
$("#btnLogin").onclick = doLogin;
$("#btnReset").onclick = doReset;

$("#btnResendVerify").onclick = resendVerify;
$("#btnCheckVerified").onclick = checkVerified;
$("#btnLogoutFromVerify").onclick = logout;

/* Auto session restore */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  // إن كان البريد/الباسورد غير مؤكد: امنع الدخول
  if (user.providerData?.some(p => p.providerId === "password") && !user.emailVerified) {
    msg("الحساب غير مُؤكد. فعّل بريدك أولًا.");
    showVerifyGate();
    return;
  }

  // Google: تأكد من الاسم
  if (user.providerData?.some(p => p.providerId === "google.com")) {
    await askNameIfMissing(user);
  } else {
    const prof = await getProfile(user.uid);
    const dn = prof?.displayName || user.displayName || "لاعب";
    await ensureUserProfile(user.uid, dn);
  }

  location.href = "app.html";
});

/* default */
showLogin();
msg("—");
