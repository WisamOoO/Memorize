// verify.js
import { auth } from "./firebase.js";
import { applyActionCode } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const msg = document.querySelector("#msg");

function setMsg(t,bad=false){
  msg.textContent = t || "";
  msg.style.color = bad ? "#EF4444" : "";
}

// لو الصفحة مفتوحة عبر رابط التأكيد من الإيميل
const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const oobCode = params.get("oobCode");

(async () => {
  if (mode === "verifyEmail" && oobCode) {
    try{
      await applyActionCode(auth, oobCode);
      setMsg("تم تأكيد البريد بنجاح. يمكنك الآن تسجيل الدخول.");
    }catch(e){
      setMsg("فشل تأكيد البريد. قد يكون الرابط منتهيًا.", true);
    }
  }
})();