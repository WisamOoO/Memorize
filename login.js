import { auth, googleProvider } from "./firebase.js";
import { guardLoginLike, redirect } from "./auth-guard.js";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

guardLoginLike();

const toast = (msg)=>{
  const t = document.querySelector("#toast");
  t.style.display = "block";
  t.textContent = msg;
};

document.querySelector("#btnLogin").onclick = async ()=>{
  const email = document.querySelector("#email").value.trim();
  const pass = document.querySelector("#pass").value;
  if (!email || !pass) return toast("أدخل البريد وكلمة المرور.");

  try{
    await signInWithEmailAndPassword(auth, email, pass);
    // التحويل يتم من guardLoginLike عبر onAuthStateChanged
  }catch(e){
    toast("فشل تسجيل الدخول. تحقق من البيانات.");
  }
};

document.querySelector("#btnGoogle").onclick = async ()=>{
  try{
    await signInWithPopup(auth, googleProvider);
    // التحويل سيتم حسب الحالة (اسم/تأكيد/…)
  }catch(e){
    toast("فشل تسجيل الدخول عبر Google.");
  }
};