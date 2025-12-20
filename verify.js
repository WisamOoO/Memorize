import { auth } from "./firebase.js";
import { guardVerifyPage, redirect, isPasswordUser, needsName } from "./auth-guard.js";
import {
  applyActionCode,
  onAuthStateChanged,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

guardVerifyPage();

const msg = document.querySelector("#msg");
const toast = (t)=>{
  const el = document.querySelector("#toast");
  el.style.display = "block";
  el.textContent = t;
};

function getParams(){
  const u = new URL(location.href);
  return {
    mode: u.searchParams.get("mode"),
    oobCode: u.searchParams.get("oobCode"),
  };
}

async function handleVerifyLink(){
  const { mode, oobCode } = getParams();
  if (mode !== "verifyEmail" || !oobCode) return false;
  try{
    await applyActionCode(auth, oobCode);
    msg.textContent = "تم تأكيد البريد بنجاح. يمكنك تسجيل الدخول الآن.";
    return true;
  }catch(e){
    msg.textContent = "فشل تأكيد البريد. قد يكون الرابط منتهيًا أو مستخدمًا.";
    return true;
  }
}

document.querySelector("#btnResend").onclick = async ()=>{
  const user = auth.currentUser;
  if (!user) return toast("سجّل دخولك أولًا ثم أعد الإرسال.");
  try{
    await sendEmailVerification(user, {
      url: `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}verify.html`
    });
    toast("تم إرسال رابط التأكيد.");
  }catch(e){
    toast("فشل الإرسال.");
  }
};

(async ()=>{
  const linkHandled = await handleVerifyLink();
  if (linkHandled) return;

  onAuthStateChanged(auth, (user)=>{
    if (!user){
      msg.textContent = "سجّل دخولك ثم قم بتأكيد بريدك من الرابط المرسل.";
      return;
    }

    if (!isPasswordUser(user)){
      // Google عادة يكون verified
      if (needsName(user)) return redirect("./google-name.html");
      return redirect("./app.html");
    }

    if (user.emailVerified){
      if (needsName(user)) return redirect("./google-name.html");
      return redirect("./app.html");
    }

    msg.textContent = "حسابك يحتاج تأكيد البريد. افتح رابط التأكيد المرسل إلى بريدك.";
    document.querySelector("#btnResend").style.display = "";
  });
})(); 
