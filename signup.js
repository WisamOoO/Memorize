// signup.js
import { auth, db, doc, setDoc, serverTimestamp } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (s) => document.querySelector(s);
const msg = $("#msg");

function setMsg(t, bad=false){
  msg.textContent = t || "";
  msg.style.color = bad ? "#EF4444" : "";
}

function hasSequentialDigits(p){
  return /012|123|234|345|456|567|678|789/.test(p);
}
function tooManySameChar(p){
  return /(.)\1\1\1/.test(p); // 4 نفس الحرف ورا بعض
}
function validPassword(p){
  if (!p || p.length < 8) return "كلمة المرور يجب ألا تقل عن 8 أحرف.";
  if (hasSequentialDigits(p)) return "لا تستخدم أرقام متتالية مثل 1234.";
  if (tooManySameChar(p)) return "لا تكرر نفس الحرف أكثر من اللازم.";
  return null;
}

$("#btnSignup").onclick = async () => {
  setMsg("");
  const name = $("#name").value.trim();
  const email = $("#email").value.trim();
  const p1 = $("#pass1").value;
  const p2 = $("#pass2").value;

  if (!name || !email || !p1 || !p2) {
    setMsg("املأ جميع الحقول.", true);
    return;
  }
  if (p1 !== p2) {
    setMsg("كلمتا المرور غير متطابقتين.", true);
    return;
  }

  const pv = validPassword(p1);
  if (pv) {
    setMsg(pv, true);
    return;
  }

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, p1);
    await updateProfile(cred.user, { displayName: name });

    // أنشئ وثيقة المستخدم
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName: name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      state: null
    }, { merge: true });

    // إرسال تأكيد البريد
    await sendEmailVerification(cred.user);

    // ممنوع استخدام التطبيق قبل التأكيد
    await signOut(auth);

    window.location.replace("verify.html");
  }catch(e){
    setMsg("فشل إنشاء الحساب. ربما البريد مستخدم مسبقًا.", true);
  }
};