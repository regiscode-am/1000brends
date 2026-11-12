import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, addDoc, deleteDoc, updateDoc,
  query, orderBy, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, CLOUDINARY, TARGET } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

$("targetTxt").textContent = TARGET;
let eligibleUsers = [];

/* ---------- auth ---------- */
$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("pass").value);
  } catch (e) {
    $("loginErr").textContent = e.message.replace("Firebase: ", "");
  }
};
$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  let isAdmin = false;
  if (user) {
    try {
      isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists();
    } catch { isAdmin = false; }
  }
  if (user && !isAdmin) {
    $("loginErr").textContent = "Այս հաշիվը admin չէ";
    await signOut(auth);
    return;
  }
  $("loginPanel").classList.toggle("hidden", isAdmin);
  $("adminArea").classList.toggle("hidden", !isAdmin);
  $("logoutBtn").classList.toggle("hidden", !isAdmin);
  if (isAdmin) loadBrands();
});

/* ---------- Cloudinary ---------- */
async function uploadLogo(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY.uploadPreset);
  fd.append("folder", "brands");
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Cloudinary upload failed");
  // փոքրացնում ենք + auto format՝ արագ բեռնման համար
  return data.secure_url.replace("/upload/", "/upload/c_fit,w_300,h_300,f_auto,q_auto/");
}

/* ---------- brands ---------- */
async function loadBrands() {
  const snap = await getDocs(query(collection(db, "brands"), orderBy("order")));
  const list = $("list");
  list.innerHTML = "";
  $("count").textContent = snap.size;

  snap.forEach((d) => {
    const b = d.data();
    const row = document.createElement("div");
    row.className = "item";

    const img = document.createElement("img");
    img.src = b.logo;
    img.alt = "";

    const meta = document.createElement("div");
    meta.className = "meta";
    const n = document.createElement("div");
    n.textContent = b.name;
    const l = document.createElement("small");
    l.textContent = b.link;
    meta.append(n, l);

    const toggle = document.createElement("button");
    toggle.className = "ghost";
    toggle.textContent = b.active === false ? "Միացնել" : "Անջատել";
    toggle.onclick = async () => {
      await updateDoc(doc(db, "brands", d.id), { active: b.active === false });
      loadBrands();
    };

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Ջնջել";
    del.onclick = async () => {
      if (!confirm("Ջնջե՞լ " + b.name + "֊ը")) return;
      await deleteDoc(doc(db, "brands", d.id));
      loadBrands();
    };

    row.append(img, meta, toggle, del);
    list.appendChild(row);
  });
}

$("addBtn").onclick = async () => {
  const name = $("brandName").value.trim();
  const link = $("brandLink").value.trim();
  const file = $("brandLogo").files[0];
  $("addErr").textContent = "";

  if (!name || !link || !file) { $("addErr").textContent = "Լրացրու բոլոր դաշտերը"; return; }
  if (!/^https?:\/\//i.test(link)) { $("addErr").textContent = "Հղումը պետք է սկսվի http:// կամ https://"; return; }

  $("addBtn").disabled = true;
  $("addBtn").textContent = "Բեռնվում է...";
  try {
    const logo = await uploadLogo(file);
    await addDoc(collection(db, "brands"), {
      name, link, logo, active: true, order: Date.now(),
    });
    $("brandName").value = "";
    $("brandLink").value = "";
    $("brandLogo").value = "";
    loadBrands();
  } catch (e) {
    $("addErr").textContent = e.message;
  } finally {
    $("addBtn").disabled = false;
    $("addBtn").textContent = "Ավելացնել";
  }
};

/* ---------- raffle ---------- */
$("loadUsers").onclick = async () => {
  const snap = await getDocs(query(collection(db, "users"), where("coins", ">=", TARGET)));
  eligibleUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  $("eligible").textContent = eligibleUsers.length;
  $("drawBtn").disabled = eligibleUsers.length === 0;
  $("winner").textContent = "";
};

$("drawBtn").onclick = () => {
  if (!eligibleUsers.length) return;
  // crypto-ով ավելի արդար պատահական ընտրություն
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const w = eligibleUsers[buf[0] % eligibleUsers.length];
  $("winner").textContent = `🏆 ${w.name || "—"} (${w.email})`;
};
