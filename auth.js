// auth.js
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  reload,
  applyActionCode
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { auth, upsertUserProfile, ensureUserProfileReady } from "./firebase.js";

const $ = (s)=>document.querySelector(s);

function openModal(title, msg){
  const host = $("#modalHost");
  if (!host) { alert(msg); return; }
  host.innerHTML = `
    <div class="modal">
      <div class="modal__head">
        <h3>${escapeHTML(title)}</h3>
        <button class="btn btn--small btn--ghost" id="mClose">
          <span class="material-icons">close</span> إغلاق
        </button>
      </div>
      <div class="modalRow">${escapeHTML(msg)}</div>
    </div>
  `;
  host.classList.add("show");
  $("#mClose").onclick = ()=>{ host.classList.remove("show"); host.innerHTML=""; };
  host.onclick = (e)=>{ if(e.target===host){ host.classList.remove("show"); host.innerHTML=""; } };
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function isSequentialDigits(p){
  const digits = p.replace(/\D/g,"");
  if (digits.length < 4) return false;
  // وجود مقطع متتالي 4 أرقام (1234 أو 4321)
  for(let i=0;i+3<digits.length;i++){
    const a = digits.charCodeAt(i);
    let inc=true, dec=true;
    for(let j=1;j<4;j++){
      inc = inc && (digits.charCodeAt(i+j) === a+j);
      dec = dec && (digits.charCodeAt(i+j) === a-j);
    }
    if (inc || dec) return true;
  }
  return false;
}

function isWeakPassword(email, pass){
  if (!pass || pass.length < 8) return "كلمة المرور يجب ألا تقل عن 8 خانات.";
  if (/^(.)\1+$/.test(pass)) return "كلمة المرور ضعيفة (تكرار نفس الحرف).";
  if (isSequentialDigits(pass)) return "كلمة المرور ضعيفة (أرقام متتالية).";
  const e = String(email||"").split("@")[0].toLowerCase();
  if (e && pass.toLowerCase().includes(e)) return "لا تجعل كلمة المرور تحتوي على بريدك.";
  return null;
}

async function redirectAfterLogin(user){
  // منع الاستخدام قبل verify للباسورد
  if (!user.emailVerified && user.providerData?.some(p=>p.providerId==="password")) {
    location.replace("verify.html");
    return;
  }
  const ok = await ensureUserProfileReady(user.uid);
  if (!ok) { location.replace("profile.html"); return; }
  location.replace("app.html");
}

/* --------- Page routing by existing elements --------- */
const page = {
  login: !!$("#btnLogin"),
  signup: !!$("#btnSignup"),
  reset: !!$("#btnReset"),
  verify: !!$("#btnResend"),
  profile: !!$("#btnSaveName"),
};

/* --------- Guard: if already logged in, skip auth pages --------- */
onAuthStateChanged(auth, async (user)=>{
  if (!user) return;

  if (page.profile) return; // profile page needs user
  if (page.verify) return;  // verify page needs user

  // إذا على login/signup/reset وهو مسجل: حوله
  await redirectAfterLogin(user);
});

/* ---------------- LOGIN ---------------- */
if (page.login){
  $("#btnLogin").onclick = async ()=>{
    const email = $("#loginEmail").value.trim();
    const pass  = $("#loginPass").value;
    if (!email || !pass) { openModal("خطأ","أدخل البريد وكلمة المرور."); return; }
    try{
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await redirectAfterLogin(cred.user);
    }catch(e){
      openModal("فشل الدخول", e?.message || "حدث خطأ.");
    }
  };

  $("#btnGoogle").onclick = async ()=>{
    try{
      const prov = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, prov);

      // Google غالباً verified
      await upsertUserProfile(cred.user.uid, {
        email: cred.user.email || "",
        provider: "google"
      });

      await redirectAfterLogin(cred.user);
    }catch(e){
      openModal("فشل Google", e?.message || "حدث خطأ.");
    }
  };
}

/* ---------------- SIGNUP ---------------- */
if (page.signup){
  $("#btnSignup").onclick = async ()=>{
    const name  = $("#suName").value.trim();
    const email = $("#suEmail").value.trim();
    const p1    = $("#suPass").value;
    const p2    = $("#suPass2").value;

    if (!name) { openModal("خطأ","أدخل الاسم."); return; }
    if (!email) { openModal("خطأ","أدخل البريد."); return; }
    if (p1 !== p2) { openModal("خطأ","كلمتا المرور غير متطابقتين."); return; }

    const weak = isWeakPassword(email, p1);
    if (weak) { openModal("كلمة مرور غير مناسبة", weak); return; }

    try{
      const cred = await createUserWithEmailAndPassword(auth, email, p1);
      await upsertUserProfile(cred.user.uid, {
        displayName: name,
        email,
        provider: "password",
        createdAt: Date.now()
      });

      await sendEmailVerification(cred.user);
      location.replace("verify.html");
    }catch(e){
      openModal("فشل إنشاء الحساب", e?.message || "حدث خطأ.");
    }
  };
}

/* ---------------- RESET ---------------- */
if (page.reset){
  $("#btnReset").onclick = async ()=>{
    const email = $("#rsEmail").value.trim();
    if (!email) { openModal("خطأ","أدخل البريد."); return; }
    try{
      await sendPasswordResetEmail(auth, email);
      openModal("تم","تم إرسال رابط تغيير كلمة المرور إلى بريدك.");
    }catch(e){
      openModal("فشل الإرسال", e?.message || "حدث خطأ.");
    }
  };
}

/* ---------------- VERIFY ---------------- */
if (page.verify){
  // Handle verify link action
  (async ()=>{
    const url = new URL(location.href);
    const mode = url.searchParams.get("mode");
    const code = url.searchParams.get("oobCode");
    if (mode === "verifyEmail" && code){
      try{
        await applyActionCode(auth, code);
        await reload(auth.currentUser);
        openModal("تم التفعيل","تم تأكيد البريد بنجاح. سيتم تحويلك للعبة.");
        setTimeout(async ()=>{
          const u = auth.currentUser;
          if (u) await redirectAfterLogin(u);
          else location.replace("login.html");
        }, 900);
      }catch(e){
        openModal("فشل التأكيد", e?.message || "الرابط غير صالح أو منتهي.");
      }
    }
  })();

  $("#btnResend").onclick = async ()=>{
    const u = auth.currentUser;
    if (!u) { location.replace("login.html"); return; }
    try{
      await sendEmailVerification(u);
      openModal("تم","أُرسلت رسالة تأكيد جديدة.");
    }catch(e){
      openModal("فشل", e?.message || "حدث خطأ.");
    }
  };

  $("#btnRecheck").onclick = async ()=>{
    const u = auth.currentUser;
    if (!u) { location.replace("login.html"); return; }
    await reload(u);
    if (u.emailVerified){
      await redirectAfterLogin(u);
    }else{
      openModal("غير مؤكد بعد","ما زال البريد غير مؤكد. افتح البريد واضغط رابط التأكيد.");
    }
  };

  // guard: if logged out
  onAuthStateChanged(auth, (u)=>{
    if (!u) location.replace("login.html");
  });
}

/* ---------------- PROFILE (name after Google) ---------------- */
if (page.profile){
  onAuthStateChanged(auth, async (u)=>{
    if (!u) { location.replace("login.html"); return; }

    // إذا مستخدم password غير verified لا يدخل
    if (!u.emailVerified && u.providerData?.some(p=>p.providerId==="password")){
      location.replace("verify.html"); return;
    }

    const ok = await ensureUserProfileReady(u.uid);
    if (ok) { location.replace("app.html"); return; }
  });

  $("#btnSaveName").onclick = async ()=>{
    const u = auth.currentUser;
    if (!u) { location.replace("login.html"); return; }
    const name = $("#pfName").value.trim();
    if (!name) { openModal("خطأ","أدخل الاسم."); return; }

    try{
      await upsertUserProfile(u.uid, {
        displayName: name,
        email: u.email || "",
        provider: u.providerData?.[0]?.providerId || "unknown",
        createdAt: Date.now()
      });
      location.replace("app.html");
    }catch(e){
      openModal("فشل", e?.message || "حدث خطأ.");
    }
  };

  $("#btnLogout").onclick = async ()=>{
    await signOut(auth);
    location.replace("login.html");
  };
}
