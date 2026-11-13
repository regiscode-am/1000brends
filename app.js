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
import { WAIT_SECONDS, PRIZE_AMOUNT, DRAW_DATE, CONTACT, PARTNER_PRICE } from "./settings.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

let currentUser = null;
let coins = 0;
let brands = [];
let visited = new Set();
const pending = new Map();   // brandId -> startMs
const tiles = new Map();     // brandId -> element
const creating = new Set();
const claiming = new Set();
const nextTry = new Map();
let brandsLoaded = false;

/* ---------- helpers ---------- */
function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : null;
  } catch { return null; }
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ---------- static page parts ---------- */
$("targetTxt").textContent = TARGET;
$("partnerPrice").innerHTML = `${PARTNER_PRICE} <small>֏</small>`;

// jackpot digits
(function renderJackpot() {
  const s = PRIZE_AMOUNT.toLocaleString("en-US").replace(/,/g, " ");
  const box = $("jackpot");
  for (const ch of s) {
    const d = document.createElement("div");
    d.className = ch === " " ? "digit sep" : "digit";
    d.textContent = ch === " " ? "" : ch;
    box.appendChild(d);
  }
  const c = document.createElement("div");
  c.className = "currency";
  c.textContent = "֏";
  box.appendChild(c);
})();

// floating coins
(function floatingCoins() {
  const hero = $("hero");
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.className = "float-coin";
    s.textContent = "🪙";
    s.style.left = Math.random() * 95 + "%";
    s.style.animationDuration = 6 + Math.random() * 7 + "s";
    s.style.animationDelay = Math.random() * 8 + "s";
    s.style.fontSize = 18 + Math.random() * 18 + "px";
    hero.appendChild(s);
  }
})();

// contacts
(function renderContacts() {
  const box = $("contacts");
  const add = (href, text) => {
    const a = document.createElement("a");
    a.className = "btn";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = text;
    box.appendChild(a);
  };
  if (CONTACT.whatsapp) {
    const text = encodeURIComponent(CONTACT.whatsappMessage || "");
    add(`https://wa.me/${CONTACT.whatsapp}?text=${text}`, "💬 WhatsApp");
  }
  if (CONTACT.instagram) add(CONTACT.instagram, "📷 Instagram");
  if (CONTACT.telegram) add(CONTACT.telegram, "✈️ Telegram");
  if (CONTACT.phone) add("tel:" + CONTACT.phone, "📞 Զանգել՝ " + (CONTACT.phoneLabel || CONTACT.phone));
  if (!box.children.length) {
    const p = document.createElement("p");
    p.textContent = "Կապի տվյալները շուտով կավելանան";
    box.appendChild(p);
  }
})();

// draw countdown
(function drawCountdown() {
  if (!DRAW_DATE) return;
  const end = new Date(DRAW_DATE).getTime();
  if (isNaN(end)) return;
  const box = $("drawCountdown");
  box.classList.remove("hidden");
  const tick = () => {
    let left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    const d = Math.floor(left / 86400); left %= 86400;
    const h = Math.floor(left / 3600); left %= 3600;
    const m = Math.floor(left / 60);
    const s = left % 60;
    box.innerHTML = [[d, "օր"], [h, "ժամ"], [m, "րոպե"], [s, "վրկ"]]
      .map(([v, l]) => `<div class="cd"><b>${String(v).padStart(2, "0")}</b><small>${l}</small></div>`)
      .join("");
  };
  tick();
  setInterval(tick, 1000);
})();

$("heroCta").onclick = () => {
  if (!currentUser) openAuth();
  else document.getElementById("brands").scrollIntoView();
};

/* ---------- brands ---------- */
async function loadBrands() {
  const snap = await getDocs(query(collection(db, "brands"), orderBy("order")));
  brands = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.active !== false);
  brandsLoaded = true;
  renderGrid();
}

function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  tiles.clear();
  $("empty").classList.toggle("hidden", brands.length > 0);
  for (const b of brands) {
    const el = document.createElement("button");
    el.className = "tile";
    el.title = b.name;
    const img = document.createElement("img");
    img.src = b.logo;
    img.alt = b.name;
    img.loading = "lazy";
    const timer = document.createElement("span");
    timer.className = "timer";
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    el.append(img, timer, check);
    el.addEventListener("click", () => onBrandClick(b));
    grid.appendChild(el);
    tiles.set(b.id, el);
    applyTileState(b.id);
  }
}

function applyTileState(id) {
  const el = tiles.get(id);
  if (!el) return;
  el.classList.toggle("done", visited.has(id));
  el.classList.toggle("pending", pending.has(id) && !visited.has(id));
}

async function loadUserState() {
  visited = new Set();
  pending.clear();
  if (!currentUser) return;
  const uid = currentUser.uid;
  const [v, p] = await Promise.all([
    getDocs(collection(db, "users", uid, "visited")),
    getDocs(collection(db, "users", uid, "pending")),
  ]);
  v.forEach((d) => visited.add(d.id));
  p.forEach((d) => {
    const ms = d.data().startedAt?.toMillis?.();
    if (ms && !visited.has(d.id)) pending.set(d.id, ms);
  });
}

/* ---------- click -> timer -> coin ---------- */
async function onBrandClick(brand) {
  const url = safeUrl(brand.link);
  if (!url) return;

  if (!currentUser) {
    openAuth();
    toast("Նախ գրանցվիր կամ մուտք գործիր, որ coin ստանաս");
    return;
  }

  // Միաժամանակ միայն մեկ timer (coin-ը տրվում է առավելագույնը 5 րոպեն մեկ)
  const other = [...pending.keys()].find((k) => k !== brand.id && !visited.has(k));
  if (other && !visited.has(brand.id)) {
    const left = Math.max(0, WAIT_SECONDS - Math.floor((Date.now() - pending.get(other)) / 1000));
    toast(`Մեկ այլ բրենդի timer-ը դեռ աշխատում է (${fmtTime(left)}): Սպասիր, մինչև coin-ը ավելանա`, 4500);
    return;
  }

  // popup blocker-ից խուսափելու համար թաբը բացում ենք անմիջապես
  window.open(url, "_blank", "noopener");

  if (visited.has(brand.id)) { toast("Այս բրենդի coin-ը արդեն ստացել ես ✓"); return; }
  if (pending.has(brand.id)) { toast("Timer-ը արդեն աշխատում է։ Թող այս էջը բաց մնա"); return; }
  if (creating.has(brand.id)) return;

  creating.add(brand.id);
  try {
    const ref = doc(db, "users", currentUser.uid, "pending", brand.id);
    await setDoc(ref, { startedAt: serverTimestamp() });
    pending.set(brand.id, Date.now());
    applyTileState(brand.id);
    tick();
    toast(`Մնա բրենդի կայքում ${Math.round(WAIT_SECONDS / 60)} րոպե, և coin-ը ավտոմատ կավելանա։ Այս էջը թող բաց մնա`, 5000);
  } catch (e) {
    console.error(e);
    toast("Չհաջողվեց սկսել։ Փորձիր նորից");
  } finally {
    creating.delete(brand.id);
  }
}

function tick() {
  const now = Date.now();
  for (const [id, start] of pending) {
    if (visited.has(id)) continue;
    // ջնջված կամ անջատված բրենդի timer-ը չի խանգարում նորերին
    if (brandsLoaded && !tiles.has(id)) { pending.delete(id); continue; }
    const left = WAIT_SECONDS - Math.floor((now - start) / 1000);
    const el = tiles.get(id);
    if (el) {
      el.classList.add("pending");
      el.querySelector(".timer").textContent = left > 0 ? "⏳ " + fmtTime(left) : "🪙 ...";
    }
    // +3 վրկ պաշար՝ ժամացույցների տարբերության համար
    if (left <= -3 && !claiming.has(id) && (nextTry.get(id) || 0) <= now) claim(id);
  }
}
setInterval(tick, 1000);

async function claim(id) {
  if (!currentUser) return;
  claiming.add(id);
  try {
    const uid = currentUser.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid, "visited", id), { at: serverTimestamp() });
    batch.update(doc(db, "users", uid), { coins: increment(1), lastBrand: id, lastClaimAt: serverTimestamp() });
    await batch.commit();
    visited.add(id);
    pending.delete(id);
    coins += 1;
    applyTileState(id);
    updateCoins();
    toast("🎉 +1 coin ավելացավ!");
  } catch (e) {
    console.error("claim failed", e);
    nextTry.set(id, Date.now() + 8000); // կրկին կփորձի 8 վրկ հետո
  } finally {
    claiming.delete(id);
  }
}

function updateCoins() {
  $("coins").textContent = "🪙 " + coins;
  const pct = Math.min(100, (coins / TARGET) * 100);
  $("barFill").style.width = pct + "%";
  $("progressText").textContent =
    coins >= TARGET
      ? `🎉 Դու հավաքել ես ${TARGET} coin և մասնակցում ես ${PRIZE_AMOUNT.toLocaleString("en-US").replace(/,/g, " ")} ֏ խաղարկությանը։`
      : `${coins} / ${TARGET} coin։ Խաղարկությանը մասնակցելու համար պետք է հավաքես ${TARGET}`;
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
    await loadUserState();
    updateCoins();
  } else {
    coins = 0;
    visited = new Set();
    pending.clear();
    $("barFill").style.width = "0";
    $("progressText").textContent = "Մուտք գործիր՝ coin հավաքելու համար";
  }
  for (const id of tiles.keys()) applyTileState(id);
});

loadBrands();
