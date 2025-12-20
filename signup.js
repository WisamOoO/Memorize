import { auth } from "./firebase.js";
import { guardLoginLike, redirect } from "./auth-guard.js";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

guardLoginLike();

const toast = (msg)=>{
  const t = document.querySelector("#toast");
  t.style.display = "block";
  t.textContent = msg;
};

function isWeakPassword(pw, email){
  if (!pw || pw.length < 8) return "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
  const digitsSeq = "0123456789";
  for (let i=0;i<=digitsSeq.length-8;i++){
    if (pw.includes(digitsSeq.slice(i,i+8))) return "تجنب الأرقام المتتالية مثل 12345678.";
  }
  const allSame = pw.split("").every(ch => ch === pw[0]);
  if (allSame) return "تجنب تكرار نفس الحرف بالكامل.";
  if (email){
    const local = email.split("@")[0] || "";
    if (local && pw.toLowerCase().includes(local.toLowerCase())) return "تجنب وضع جزء من بريدك داخل كلمة المرور.";
  }
  return null;
}

document.querySelector("#btnSignup").onclick = async ()=>{
  const name = document.querySelector("#name").value.trim();
  const email = document.querySelector("#email").value.trim();
  const p1 = document.querySelector("#pass1").value;
  const p2 = document.querySelector("#pass2").value;

  if (!name) return toast("أدخل الاسم.");
  if (!email) return toast("أدخل البريد.");
  if (!p1 || !p2) return toast("أدخل كلمة المرور مرتين.");
  if (p1 !== p2) return toast("كلمتا المرور غير متطابقتين.");

  const weak = isWeakPassword(p1, email);
  if (weak) return toast(weak);

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, p1);
    await updateProfile(cred.user, { displayName: name });

    // إرسال تأكيد البريد
    await sendEmailVerification(cred.user, {
      url: `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}verify.html`
    });

    redirect("./verify.html");
  }catch(e){
    toast("فشل إنشاء الحساب. قد يكون البريد مستخدمًا سابقًا.");
  }
};