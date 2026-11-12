import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, writeBatch,
  query, orderBy, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, TARGET } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
let currentUser = null;
let coins = 0;
let brands = [];
let visited = new Set();
let busy = new Set();

/* ---------- helpers ---------- */
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : null;
  } catch { return null; }
}

/* ---------- brands ---------- */
async function loadBrands() {
  const snap = await getDocs(query(collection(db, "brands"), orderBy("order")));
  brands = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.active !== false);
  renderGrid();
}

function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").classList.toggle("hidden", brands.length > 0);
  for (const b of brands) {
    const el = document.createElement("button");
    el.className = "tile" + (visited.has(b.id) ? " done" : "");
    el.title = b.name;
    el.dataset.id = b.id;
    const img = document.createElement("img");
    img.src = b.logo;
    img.alt = b.name;
    img.loading = "lazy";
    el.appendChild(img);
    el.addEventListener("click", () => onBrandClick(b, el));
    grid.appendChild(el);
  }
}

async function loadVisited() {
  visited = new Set();
  if (!currentUser) return;
  const snap = await getDocs(collection(db, "users", currentUser.uid, "visited"));
  snap.forEach((d) => visited.add(d.id));
}

/* ---------- click + coin ---------- */
async function onBrandClick(brand, el) {
  const url = safeUrl(brand.link);
  if (!url) return;

  if (!currentUser) {
    // չգրանցվածին նույնպես թույլ ենք տալիս բացել, բայց coin չի ստանում
    window.open(url, "_blank", "noopener");
    openAuth();
    toast("Coin ստանալու համար մուտք գործիր");
    return;
  }

  // popup blocker-ից խուսափելու համար թաբը բացում ենք անմիջապես
  window.open(url, "_blank", "noopener");

  if (visited.has(brand.id) || busy.has(brand.id)) return;
  busy.add(brand.id);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", currentUser.uid, "visited", brand.id), { at: serverTimestamp() });
    batch.update(doc(db, "users", currentUser.uid), { coins: increment(1), lastBrand: brand.id });
    await batch.commit();
    visited.add(brand.id);
    coins += 1;
    el.classList.add("done");
    updateCoins();
    toast("+1 🪙");
  } catch (e) {
    console.error(e);
    toast("Չհաջողվեց coin ավելացնել");
  } finally {
    busy.delete(brand.id);
  }
}

function updateCoins() {
  $("coins").textContent = "🪙 " + coins;
  const pct = Math.min(100, (coins / TARGET) * 100);
  $("barFill").style.width = pct + "%";
  $("progressText").textContent =
    coins >= TARGET
      ? "🎉 Դու հավաքել ես " + TARGET + " coin և մասնակցում ես խաղարկությանը։"
      : `${coins} / ${TARGET} coin՝ խաղարկությանը մասնակցելու համար`;
}

/* ---------- auth ---------- */
let registerMode = false;

function openAuth() { $("authModal").classList.add("open"); }
function closeAuth() { $("authModal").classList.remove("open"); $("authErr").textContent = ""; }
function setMode(reg) {
  registerMode = reg;
  $("authTitle").textContent = reg ? "Գրանցում" : "Մուտք";
  $("authSubmit").textContent = reg ? "Գրանցվել" : "Մուտք";
  $("toggleMode").textContent = reg ? "Արդեն ունեմ հաշիվ" : "Գրանցվել";
  $("nameInput").classList.toggle("hidden", !reg);
}

async function ensureUserDoc(user, name) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: name || user.displayName || "",
      email: user.email || "",
      coins: 0,
      createdAt: serverTimestamp(),
    });
  }
}

$("loginBtn").onclick = openAuth;
$("closeAuth").onclick = closeAuth;
$("toggleMode").onclick = () => setMode(!registerMode);
$("logoutBtn").onclick = () => signOut(auth);

$("authSubmit").onclick = async () => {
  const email = $("emailInput").value.trim();
  const pass = $("passInput").value;
  const name = $("nameInput").value.trim();
  $("authErr").textContent = "";
  try {
    if (registerMode) {
      if (!name) { $("authErr").textContent = "Գրիր անունդ"; return; }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      await ensureUserDoc(cred.user, name);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    closeAuth();
  } catch (e) {
    $("authErr").textContent = e.message.replace("Firebase: ", "");
  }
};

$("googleBtn").onclick = async () => {
  try {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    await ensureUserDoc(cred.user);
    closeAuth();
  } catch (e) {
    $("authErr").textContent = e.message.replace("Firebase: ", "");
  }
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const logged = !!user;
  $("loginBtn").classList.toggle("hidden", logged);
  $("logoutBtn").classList.toggle("hidden", !logged);
  $("coins").classList.toggle("hidden", !logged);
  $("userName").classList.toggle("hidden", !logged);

  if (user) {
    await ensureUserDoc(user);
    const snap = await getDoc(doc(db, "users", user.uid));
    coins = snap.data()?.coins || 0;
    $("userName").textContent = snap.data()?.name || user.email;
    await loadVisited();
    updateCoins();
  } else {
    coins = 0;
    visited = new Set();
    $("barFill").style.width = "0";
    $("progressText").textContent = "Մուտք գործիր՝ coin հավաքելու համար";
  }
  renderGrid();
});

loadBrands();
