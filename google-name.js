import { auth } from "./firebase.js";
import { guardGoogleNamePage, redirect } from "./auth-guard.js";
import {
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { ensureUserDoc } from "./auth-guard.js";

guardGoogleNamePage();

const toast = (t)=>{
  const el = document.querySelector("#toast");
  el.style.display = "block";
  el.textContent = t;
};

document.querySelector("#btnSave").onclick = async ()=>{
  const name = document.querySelector("#name").value.trim();
  if (!name) return toast("أدخل الاسم.");

  const user = auth.currentUser;
  if (!user) return redirect("./login.html");

  try{
    await updateProfile(user, { displayName: name });
    await ensureUserDoc(user);
    redirect("./app.html");
  }catch(e){
    toast("فشل حفظ الاسم.");
  }
};

document.querySelector("#btnLogout").onclick = async ()=>{
  await signOut(auth);
  redirect("./login.html");
};