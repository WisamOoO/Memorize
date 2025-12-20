import { auth } from "./firebase.js";
import {
  sendPasswordResetEmail,
  confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

function weak(pw){
  if (!pw || pw.length < 8) return "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
  const digitsSeq = "0123456789";
  for (let i=0;i<=digitsSeq.length-8;i++){
    if (pw.includes(digitsSeq.slice(i,i+8))) return "تجنب الأرقام المتتالية مثل 12345678.";
  }
  const allSame = pw.split("").every(ch => ch === pw[0]);
  if (allSame) return "تجنب تكرار نفس الحرف بالكامل.";
  return null;
}

(async ()=>{
  const { mode, oobCode } = getParams();

  // تنفيذ تغيير كلمة المرور من رابط البريد
  if (mode === "resetPassword" && oobCode){
    document.querySelector("#sendBox").style.display = "none";
    document.querySelector("#applyBox").style.display = "block";

    document.querySelector("#btnApply").onclick = async ()=>{
      const p1 = document.querySelector("#p1").value;
      const p2 = document.querySelector("#p2").value;
      if (!p1 || !p2) return toast("أدخل كلمة المرور مرتين.");
      if (p1 !== p2) return toast("غير متطابقة.");

      const w = weak(p1);
      if (w) return toast(w);

      try{
        await confirmPasswordReset(auth, oobCode, p1);
        toast("تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.");
      }catch(e){
        toast("فشل تغيير كلمة المرور. قد يكون الرابط منتهيًا.");
      }
    };
    return;
  }

  // إرسال رابط الاستعادة
  document.querySelector("#btnSend").onclick = async ()=>{
    const email = document.querySelector("#email").value.trim();
    if (!email) return toast("أدخل البريد.");

    try{
      await sendPasswordResetEmail(auth, email, {
        url: `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}reset.html`
      });
      toast("تم إرسال رابط تغيير كلمة المرور.");
    }catch(e){
      toast("فشل الإرسال. تحقق من البريد.");
    }
  };
})();