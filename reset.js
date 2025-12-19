// reset.js
import { auth } from "./firebase.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (s) => document.querySelector(s);
const msg = $("#msg");
function setMsg(t,bad=false){
  msg.textContent = t||"";
  msg.style.color = bad ? "#EF4444" : "";
}

$("#btnSend").onclick = async () => {
  setMsg("");
  const email = $("#email").value.trim();
  if (!email) { setMsg("أدخل البريد الإلكتروني.", true); return; }

  try{
    await sendPasswordResetEmail(auth, email);
    setMsg("تم إرسال رابط تغيير كلمة المرور. تحقق من بريدك.");
  }catch(e){
    setMsg("تعذر إرسال الرابط. تحقق من البريد.", true);
  }
};
