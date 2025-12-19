// google-name.js
import { auth, db, doc, setDoc } from "./firebase.js";
import { onAuthStateChanged } from "./firebase.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const $ = (s)=>document.querySelector(s);
const msg = $("#msg");
function setMsg(t,bad=false){
  msg.textContent = t||"";
  msg.style.color = bad ? "#EF4444" : "";
}

onAuthStateChanged(auth, (user)=>{
  if (!user) window.location.replace("login.html");
});

$("#btnSave").onclick = async ()=>{
  setMsg("");
  const user = auth.currentUser;
  if (!user) { window.location.replace("login.html"); return; }

  const name = $("#name").value.trim();
  if (!name) { setMsg("أدخل الاسم.", true); return; }

  try{
    await updateProfile(user, { displayName: name });
    await setDoc(doc(db,"users",user.uid), { displayName: name }, { merge:true });
    window.location.replace("app.html");
  }catch(e){
    setMsg("تعذر حفظ الاسم.", true);
  }
};