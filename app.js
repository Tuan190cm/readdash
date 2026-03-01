/* ReadDash PWA - MVP by Vân (offline, localStorage) */

const LS_KEY = "readdash_v1";

const DEFAULT_STATE = {
  version: 1,
  settings: {
    weeklyPages: 500,
    weeklyBooks: 2,
    monthlyBooks: 8,
    yearlyBooks: 96,
    dailyMinPages: 20,
    weekStart: 1, // 1=Mon, 0=Sun
    mode: "normal" // chill|normal|push
  },
  books: [],
  sessions: [], // {id, bookId, tsStart, tsEnd?, pages, minutes, note}
  points: {
    total: 0,
    history: [] // {id, ts, delta, reason}
  },
  streaks: {
    daily: 0,
    weekly: 0,
    lastDailyDate: null,   // YYYY-MM-DD
    lastWeeklyKey: null,   // YYYY-WW
    shields: 2
  },
  ui: { bookFilter: "all" }
};

let state = loadState();

/* ------------------------ Utils ------------------------ */
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // minimal migrations
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}
function fmtDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function startOfDay(date){
  const d = new Date(date);
  d.setHours(0,0,0,0);
  return d;
}
function endOfDay(date){
  const d = new Date(date);
  d.setHours(23,59,59,999);
  return d;
}

/* ISO week key (YYYY-WW) with configurable week start */
function weekKey(date, weekStart) {
  // weekStart: 1=Mon,0=Sun
  const d = startOfDay(date);
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = (day - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  // week anchor now at start of week
  const year = d.getFullYear();
  // compute week number within year based on first week start
  const first = new Date(year,0,1);
  const firstDay = first.getDay();
  const firstDiff = (firstDay - weekStart + 7) % 7;
  const firstWeekStartDate = new Date(year,0,1 - firstDiff);
  const weeks = Math.floor((d - firstWeekStartDate) / (7*24*3600*1000)) + 1;
  const ww = String(weeks).padStart(2,"0");
  return `${year}-W${ww}`;
}
function weekRange(date, weekStart){
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day - weekStart + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
function monthKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}
function monthRange(date){
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth()+1, 0);
  return { start, end };
}
function yearRange(date){
  const start = new Date(date.getFullYear(),0,1);
  const end = new Date(date.getFullYear(),11,31);
  return { start, end };
}

function inRange(ts, start, end){
  return ts >= start.getTime() && ts <= end.getTime();
}

function sumSessions(rangeStart, rangeEnd){
  const start = startOfDay(rangeStart);
  const end = endOfDay(rangeEnd);
  const sess = state.sessions.filter(s => inRange(s.tsStart, start, end));
  const pages = sess.reduce((a,s)=>a + (s.pages||0), 0);
  const minutes = sess.reduce((a,s)=>a + (s.minutes||0), 0);
  const notes = sess.reduce((a,s)=>a + (s.note && s.note.trim() ? 1 : 0), 0);
  const sessionsCount = sess.length;
  return { pages, minutes, notes, sessionsCount, sess };
}

function finishedBooksInRange(start, end){
  const s = startOfDay(start).getTime();
  const e = endOfDay(end).getTime();
  return state.books.filter(b => b.status === "finished" && b.endDate && (parseDate(b.endDate).getTime() >= s && parseDate(b.endDate).getTime() <= e));
}

function pointsInRange(start, end){
  const s = startOfDay(start).getTime();
  const e = endOfDay(end).getTime();
  return state.points.history
    .filter(p => p.ts >= s && p.ts <= e)
    .reduce((a,p)=>a + p.delta, 0);
}

function getBook(bookId){ return state.books.find(b => b.id === bookId); }

function computeBookProgress(book){
  const pages = state.sessions
    .filter(s => s.bookId === book.id)
    .reduce((a,s)=>a + s.pages, 0);
  const done = clamp(pages, 0, book.totalPages || 0);
  const pct = book.totalPages ? Math.round((done/book.totalPages)*100) : 0;
  return { done, pct };
}

/* ------------------------ Points & Streaks ------------------------ */
function addPoints(delta, reason){
  state.points.total += delta;
  state.points.history.push({ id: uid(), ts: Date.now(), delta, reason });
}

function updateDailyStreak(){
  const today = fmtDate(new Date());
  const minPages = state.settings.dailyMinPages;
  // pages read today
  const { pages } = sumSessions(new Date(), new Date());
  const met = pages >= minPages;

  if (state.streaks.lastDailyDate === null) {
    state.streaks.daily = met ? 1 : 0;
    state.streaks.lastDailyDate = today;
    return;
  }

  const last = parseDate(state.streaks.lastDailyDate);
  const now = parseDate(today);
  const diffDays = Math.round((startOfDay(now) - startOfDay(last)) / (24*3600*1000));

  if (diffDays === 0) {
    // same day, if now met and streak was 0, set to 1? (only when lastDailyDate was today anyway)
    if (met && state.streaks.daily === 0) state.streaks.daily = 1;
    return;
  }

  // moved forward >=1 day: decide how to roll over
  if (diffDays === 1) {
    if (met) state.streaks.daily += 1;
    else {
      // allow shield
      if (state.streaks.shields > 0) state.streaks.shields -= 1;
      else state.streaks.daily = 0;
    }
  } else if (diffDays > 1) {
    // big gap -> reset (shield doesn't cover multiple days)
    state.streaks.daily = met ? 1 : 0;
  }

  state.streaks.lastDailyDate = today;
}

function updateWeeklyStreak(){
  const wk = weekKey(new Date(), state.settings.weekStart);
  const { start, end } = weekRange(new Date(), state.settings.weekStart);
  const { pages } = sumSessions(start, end);
  const met = pages >= state.settings.weeklyPages;

  if (!state.streaks.lastWeeklyKey){
    state.streaks.weekly = met ? 1 : 0;
    state.streaks.lastWeeklyKey = wk;
    return;
  }

  if (state.streaks.lastWeeklyKey === wk) {
    // same week, do nothing
    return;
  }

  // new week: determine if last week met; but we update on transition when user opens app
  // Evaluate previous week result:
  const now = new Date();
  const { start: curStart } = weekRange(now, state.settings.weekStart);
  const prevEnd = new Date(curStart);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(curStart);
  prevStart.setDate(prevStart.getDate() - 7);

  const prev = sumSessions(prevStart, prevEnd);
  const prevMet = prev.pages >= state.settings.weeklyPages;

  if (prevMet) state.streaks.weekly += 1;
  else state.streaks.weekly = 0;

  state.streaks.lastWeeklyKey = wk;
}

function maybeAwardWeeklyBonus(){
  // award once per week when hitting weeklyPages
  const wk = weekKey(new Date(), state.settings.weekStart);
  const key = `weeklyBonus_${wk}`;
  if (localStorage.getItem(key)) return;
  const { start, end } = weekRange(new Date(), state.settings.weekStart);
  const { pages } = sumSessions(start, end);
  if (pages >= state.settings.weeklyPages) {
    addPoints(50, "Weekly goal reached");
    localStorage.setItem(key, "1");
  }
}

/* ------------------------ Rendering ------------------------ */
function setTab(tab){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  $(`tab-${tab}`).classList.remove("hidden");
  renderAll();
}

function renderBookSelect(){
  const sel = $("selectBook");
  const reading = state.books.filter(b => b.status !== "finished");
  if (reading.length === 0) {
    sel.innerHTML = `<option value="">(Chưa có sách) - Thêm ở tab Books</option>`;
    return;
  }
  sel.innerHTML = reading.map(b => {
    const { done, pct } = computeBookProgress(b);
    return `<option value="${b.id}">${b.title} (${done}/${b.totalPages} • ${pct}%)</option>`;
  }).join("");
}

function renderDashboard(){
  const now = new Date();
  const { start, end } = weekRange(now, state.settings.weekStart);
  $("weekRange").textContent = `${fmtDate(start)} → ${fmtDate(end)}`;

  const w = sumSessions(start, end);
  const weekPages = w.pages;
  const weekBooks = finishedBooksInRange(start, end).length;

  const weeklyGoal = state.settings.weeklyPages;
  const pct = clamp(Math.round((weekPages/weeklyGoal)*100), 0, 200);
  $("barWeekPages").style.width = `${clamp(pct,0,100)}%`;
  $("weekPagesText").textContent = `${weekPages}`;
  $("weekBooksText").textContent = `${weekBooks}`;

  // today target calculation
  const today = startOfDay(now);
  const daysRemaining = Math.max(1, Math.round((startOfDay(end) - today)/(24*3600*1000)) + 1);
  let baseNeed = Math.max(0, weeklyGoal - weekPages);
  let baseTarget = Math.ceil(baseNeed / daysRemaining);

  const mode = state.settings.mode;
  $("todayPill").textContent = `Mode: ${mode[0].toUpperCase() + mode.slice(1)}`;

  let factor = 1;
  if (mode === "chill") factor = 0.75;
  if (mode === "push") factor = 1.25;
  let target = Math.max(0, Math.round(baseTarget * factor));

  // keep minimum to preserve streak if user wants it
  const minDaily = state.settings.dailyMinPages;
  if (target > 0) target = Math.max(target, minDaily);

  $("todayTarget").textContent = target === 0 ? "Tự chọn" : `${target} trang`;
  $("todayHint").textContent = baseNeed === 0
    ? "Tuần đã đủ 500. Đọc thêm là bonus."
    : `Còn thiếu ${baseNeed} trang • ${daysRemaining} ngày còn lại`;

  // streak + points + speed
  updateDailyStreak();
  updateWeeklyStreak();
  maybeAwardWeeklyBonus();

  $("dailyStreak").textContent = `${state.streaks.daily}`;
  $("weeklyStreak").textContent = `${state.streaks.weekly}`;
  $("weekPoints").textContent = `${pointsInRange(start, end)}`;

  const speedPH = w.minutes > 0 ? (w.pages / (w.minutes/60)) : 0;
  $("speedPH").textContent = speedPH > 0 ? speedPH.toFixed(1) : "—";

  // insight box
  const insight = buildInsight({ weekPages, weekBooks, speedPH, notes: w.notes, pages: weekPages });
  $("insightBox").textContent = insight;

  renderBookSelect();
}

function buildInsight({ weekPages, weekBooks, speedPH, notes, pages }){
  const goal = state.settings.weeklyPages;
  let msg = "";
  if (weekPages < goal) msg += `Tuần này chưa đủ ${goal}. Còn thiếu ${goal-weekPages} trang.\n`;
  else msg += `Đã đạt ${goal}/tuần. Giữ nhịp hoặc vượt để đệm tuần sau.\n`;

  if (weekBooks < state.settings.weeklyBooks && weekPages >= goal) {
    msg += `Trang đủ nhưng quyển chưa đủ: ${weekBooks}/${state.settings.weeklyBooks}. Nếu muốn bám 2 quyển/tuần thì chốt thêm 1 quyển mỏng.\n`;
  } else if (weekBooks >= state.settings.weeklyBooks && weekPages < goal) {
    msg += `Quyển đủ nhưng trang thiếu → buộc phải đọc thêm (quyển 3) hoặc kéo dài quyển hiện tại.\n`;
  }

  const density = pages > 0 ? (notes / pages) * 100 : 0;
  if (density > 0 && density < 1) msg += `Note hơi ít (${density.toFixed(1)}/100 trang). Dễ đọc lướt.\n`;
  if (speedPH > 0 && speedPH > 60) msg += `Tốc độ cao (${speedPH.toFixed(0)} trang/giờ). Coi chừng trôi kiến thức.\n`;
  if (!msg) msg = "Log đều tay. Đừng tự thương lượng với bản thân.";
  return msg.trim();
}

function renderBooks(){
  const reading = state.books.filter(b => b.status !== "finished");
  const finished = state.books.filter(b => b.status === "finished");

  $("readingList").innerHTML = reading.length
    ? reading.map(renderBookItem).join("")
    : `<div class="muted small">Chưa có quyển nào đang đọc.</div>`;

  const filter = state.ui.bookFilter;
  let list = state.books;
  if (filter === "reading") list = reading;
  if (filter === "finished") list = finished;

  $("bookList").innerHTML = list.length
    ? list.map(renderBookItem).join("")
    : `<div class="muted small">Danh sách trống.</div>`;

  // bind actions
  document.querySelectorAll("[data-act='finish']").forEach(btn => btn.onclick = () => finishBook(btn.dataset.id));
  document.querySelectorAll("[data-act='delete']").forEach(btn => btn.onclick = () => deleteBook(btn.dataset.id));
  document.querySelectorAll("[data-act='setReading']").forEach(btn => btn.onclick = () => setReading(btn.dataset.id));
}

function renderBookItem(b){
  const { done, pct } = computeBookProgress(b);
  const badge = b.status === "finished"
    ? `<span class="badge good">Finished</span>`
    : `<span class="badge warn">Reading</span>`;
  const meta = `${b.author ? b.author + " • " : ""}${done}/${b.totalPages} trang • ${pct}%`;
  const dates = b.status === "finished" && b.endDate ? `Kết thúc: ${b.endDate}` : (b.startDate ? `Bắt đầu: ${b.startDate}` : "");
  return `
    <div class="item">
      <div>
        <b>${escapeHtml(b.title)}</b>
        <div class="meta">${escapeHtml(meta)} ${dates ? " • " + escapeHtml(dates) : ""}</div>
      </div>
      <div class="actions">
        ${badge}
        ${b.status !== "finished" ? `<button class="btn" data-act="finish" data-id="${b.id}">Done</button>` : ""}
        ${b.status === "finished" ? `<button class="btn" data-act="setReading" data-id="${b.id}">Re-read</button>` : ""}
        <button class="btn" data-act="delete" data-id="${b.id}">Del</button>
      </div>
    </div>
  `;
}

function renderStats(){
  // charts
  drawChart7();
  drawChartW8();

  // quality metrics (week)
  const { start, end } = weekRange(new Date(), state.settings.weekStart);
  const w = sumSessions(start, end);
  const pages = w.pages;
  const sessionsCount = w.sessionsCount;
  const notesDensity = pages > 0 ? (w.notes / pages) * 100 : 0;
  $("notesDensity").textContent = pages > 0 ? notesDensity.toFixed(1) : "—";
  $("sessionsWeek").textContent = `${sessionsCount}`;
  $("pps").textContent = sessionsCount > 0 ? (pages/sessionsCount).toFixed(1) : "—";

  // basic quality score
  const expected = state.settings.weeklyPages;
  const pagesRatio = expected > 0 ? Math.min(1, pages/expected) : 0;
  const normNotes = clamp(notesDensity / 4, 0, 1); // 4 notes/100 pages = good
  const speedPH = w.minutes > 0 ? (pages / (w.minutes/60)) : 0;
  const normSpeed = speedPH > 0 ? clamp(1 - Math.max(0, (speedPH-60)/60), 0, 1) : 0.7; // penalize too fast
  const consistency = clamp(sessionsCount / 6, 0, 1); // sessions spread in week

  const q = Math.round(100 * (0.35*pagesRatio + 0.30*normNotes + 0.20*normSpeed + 0.15*consistency));
  $("qScore").textContent = pages > 0 ? `${q}` : "—";

  $("qualityHint").textContent = pages === 0
    ? "Chưa có dữ liệu tuần này. Log ít nhất 1 session."
    : (q >= 75
        ? "Ổn. Đọc vừa đủ sâu + đủ nhịp. Giữ streak tuần 500 là xương sống."
        : q >= 55
          ? "Đang ở mức trung bình. Tăng note density hoặc giảm tốc độ đọc lướt."
          : "Đọc đang loãng. Ưu tiên: đều session + note 1 câu sau mỗi lần đọc.");

  // session list
  const recent = [...state.sessions].sort((a,b)=>b.tsStart-a.tsStart).slice(0, 30);
  $("sessionList").innerHTML = recent.length ? recent.map(renderSessionItem).join("") : `<div class="muted small">Chưa có log.</div>`;
  document.querySelectorAll("[data-act='delSession']").forEach(btn => btn.onclick = () => deleteSession(btn.dataset.id));

  // pills
  const last7 = rangeDays(7).reduce((a,day)=>{
    const s = sumSessions(day, day);
    return a + s.pages;
  },0);
  $("avg7").textContent = `Avg: ${(last7/7).toFixed(1)} trang/ngày`;
  const w8 = weeksBack(8).map(wr => sumSessions(wr.start, wr.end).pages);
  const avgW8 = w8.reduce((a,x)=>a+x,0)/Math.max(1,w8.length);
  $("avgW8").textContent = `Avg: ${avgW8.toFixed(0)} trang/tuần`;
}

function renderSessionItem(s){
  const b = getBook(s.bookId);
  const d = new Date(s.tsStart);
  const dt = `${fmtDate(d)} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const minutes = s.minutes ? ` • ${s.minutes} phút` : "";
  const note = s.note && s.note.trim() ? `\nNote: ${s.note.trim()}` : "";
  return `
    <div class="item">
      <div>
        <b>${s.pages} trang</b> <span class="badge">${escapeHtml(b ? b.title : "Unknown")}</span>
        <div class="meta">${dt}${minutes}${note ? " • có note" : ""}</div>
      </div>
      <div class="actions">
        <button class="btn" data-act="delSession" data-id="${s.id}">Del</button>
      </div>
    </div>
  `;
}

function renderCompare(){
  // default quick compare show week
  if (!$("compareQuick").dataset.ready){
    doCompareWoW();
    $("compareQuick").dataset.ready = "1";
  }
}

function renderSettings(){
  $("gWeeklyPages").value = state.settings.weeklyPages;
  $("gWeeklyBooks").value = state.settings.weeklyBooks;
  $("gMonthlyBooks").value = state.settings.monthlyBooks;
  $("gYearlyBooks").value = state.settings.yearlyBooks;
  $("gDailyMin").value = state.settings.dailyMinPages;
  $("gWeekStart").value = String(state.settings.weekStart);

  $("totalPoints").textContent = `${state.points.total}`;

  const { start: ys, end: ye } = yearRange(new Date());
  const y = sumSessions(ys, ye);
  $("yearPages").textContent = `${y.pages}`;
  $("yearBooks").textContent = `${finishedBooksInRange(ys, ye).length}`;
  $("shields").textContent = `${state.streaks.shields}`;
}

function renderAll(){
  renderDashboard();
  renderBooks();
  renderStats();
  renderCompare();
  renderSettings();
  saveState();
}

/* ------------------------ Actions ------------------------ */
function addBook(){
  const title = $("bookTitle").value.trim();
  const pages = Number($("bookPages").value);
  const author = $("bookAuthor").value.trim();
  if (!title || !pages || pages <= 0) return alert("Nhập tên sách + tổng trang.");
  const b = { id: uid(), title, author, totalPages: pages, status: "reading", startDate: fmtDate(new Date()), endDate: null };
  state.books.unshift(b);
  $("bookTitle").value = "";
  $("bookPages").value = "";
  $("bookAuthor").value = "";
  saveState();
  renderAll();
}

function setReading(bookId){
  const b = getBook(bookId);
  if (!b) return;
  b.status = "reading";
  b.startDate = b.startDate || fmtDate(new Date());
  b.endDate = null;
  saveState();
  renderAll();
}

function finishBook(bookId){
  const b = getBook(bookId);
  if (!b) return;
  b.status = "finished";
  b.endDate = fmtDate(new Date());
  addPoints(20, "Book completed");
  saveState();
  renderAll();
}

function deleteBook(bookId){
  if (!confirm("Xoá sách? (sessions vẫn giữ, nhưng sẽ mất liên kết)")) return;
  state.books = state.books.filter(b => b.id !== bookId);
  saveState();
  renderAll();
}

function deleteSession(id){
  if (!confirm("Xoá session log?")) return;
  state.sessions = state.sessions.filter(s => s.id !== id);
  saveState();
  renderAll();
}

function openLogModal(pagesPreset=null){
  $("modalLog").classList.remove("hidden");
  $("customPages").value = pagesPreset ? String(pagesPreset) : "";
  $("customMinutes").value = $("inputMinutes").value || "";
  $("customNote").value = "";
}

function closeLogModal(){
  $("modalLog").classList.add("hidden");
}

function logPages(pages){
  const bookId = $("selectBook").value;
  if (!bookId) return alert("Chưa có sách. Qua tab Books thêm sách trước.");
  const minutes = Number($("inputMinutes").value || 0);
  const s = {
    id: uid(),
    bookId,
    tsStart: Date.now(),
    tsEnd: null,
    pages: Number(pages),
    minutes: minutes > 0 ? minutes : 0,
    note: ""
  };
  state.sessions.push(s);

  // points: +1 per 5 pages
  const delta = Math.floor(s.pages / 5);
  if (delta > 0) addPoints(delta, "Reading pages");

  // update
  saveState();
  renderAll();
}

function submitCustomLog(){
  const bookId = $("selectBook").value;
  if (!bookId) return alert("Chọn sách trước đã.");
  const pages = Number($("customPages").value);
  const minutes = Number($("customMinutes").value || 0);
  const note = $("customNote").value || "";
  if (!pages || pages <= 0) return alert("Nhập số trang hợp lệ.");

  const s = { id: uid(), bookId, tsStart: Date.now(), tsEnd: null, pages, minutes: minutes>0?minutes:0, note };
  state.sessions.push(s);

  const delta = Math.floor(pages / 5);
  if (delta > 0) addPoints(delta, "Reading pages");
  saveState();
  closeLogModal();
  renderAll();
}

function setMode(mode){
  state.settings.mode = mode;
  saveState();
  renderAll();
}

/* ------------------------ Charts (Canvas) ------------------------ */
function rangeDays(n){
  const days = [];
  const today = startOfDay(new Date());
  for (let i = n-1; i >= 0; i--){
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }
  return days;
}

function weeksBack(n){
  const arr = [];
  const now = new Date();
  // current week start
  const cur = weekRange(now, state.settings.weekStart).start;
  for (let i = n-1; i >= 0; i--){
    const start = new Date(cur);
    start.setDate(cur.getDate() - i*7);
    const end = new Date(start);
    end.setDate(start.getDate()+6);
    arr.push({ start, end });
  }
  return arr;
}

function drawChart7(){
  const c = $("chart7");
  const ctx = c.getContext("2d");
  const W = c.width = c.clientWidth * devicePixelRatio;
  const H = c.height = 160 * devicePixelRatio;
  ctx.clearRect(0,0,W,H);

  const days = rangeDays(7);
  const vals = days.map(d => sumSessions(d, d).pages);
  const max = Math.max(10, ...vals);

  // axes baseline
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#2a2a2d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H-12*devicePixelRatio);
  ctx.lineTo(W, H-12*devicePixelRatio);
  ctx.stroke();

  const barW = W / vals.length;
  vals.forEach((v,i)=>{
    const h = (v/max) * (H - 28*devicePixelRatio);
    const x = i*barW + barW*0.18;
    const y = (H-12*devicePixelRatio) - h;
    const w = barW*0.64;
    // bar
    ctx.fillStyle = "#28d17c";
    ctx.fillRect(x, y, w, h);
  });
}

function drawChartW8(){
  const c = $("chartW8");
  const ctx = c.getContext("2d");
  const W = c.width = c.clientWidth * devicePixelRatio;
  const H = c.height = 160 * devicePixelRatio;
  ctx.clearRect(0,0,W,H);

  const weeks = weeksBack(8);
  const vals = weeks.map(w => sumSessions(w.start, w.end).pages);
  const max = Math.max(state.settings.weeklyPages, ...vals, 10);

  // 500 line
  const y500 = (H - 18*devicePixelRatio) - (state.settings.weeklyPages/max)*(H-36*devicePixelRatio);
  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 2;
  ctx.setLineDash([6*devicePixelRatio, 6*devicePixelRatio]);
  ctx.beginPath();
  ctx.moveTo(0, y500);
  ctx.lineTo(W, y500);
  ctx.stroke();
  ctx.setLineDash([]);

  // line chart
  const pad = 12*devicePixelRatio;
  const plotH = H - 36*devicePixelRatio;
  const step = (W - pad*2) / (vals.length - 1);

  ctx.strokeStyle = "#7c5cff";
  ctx.lineWidth = 3*devicePixelRatio;
  ctx.beginPath();
  vals.forEach((v,i)=>{
    const x = pad + i*step;
    const y = (H - 18*devicePixelRatio) - (v/max)*plotH;
    if (i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // points
  ctx.fillStyle = "#f2f2f2";
  vals.forEach((v,i)=>{
    const x = pad + i*step;
    const y = (H - 18*devicePixelRatio) - (v/max)*plotH;
    ctx.beginPath();
    ctx.arc(x,y, 3.5*devicePixelRatio, 0, Math.PI*2);
    ctx.fill();
  });
}

/* ------------------------ Compare ------------------------ */
function pctChange(a,b){
  if (b === 0) return a === 0 ? 0 : null; // null => new
  return ((a-b)/b)*100;
}
function fmtDelta(a,b){
  const p = pctChange(a,b);
  if (p === null) return `+${a} (mới)`;
  const sign = p>0 ? "+" : "";
  return `${a} (${sign}${p.toFixed(0)}%)`;
}
function speedPH(range){
  return range.minutes > 0 ? (range.pages / (range.minutes/60)) : 0;
}
function compareRanges(labelA, aStart, aEnd, labelB, bStart, bEnd){
  const A = sumSessions(aStart, aEnd);
  const B = sumSessions(bStart, bEnd);
  const booksA = finishedBooksInRange(aStart, aEnd).length;
  const booksB = finishedBooksInRange(bStart, bEnd).length;
  const pointsA = pointsInRange(aStart, aEnd);
  const pointsB = pointsInRange(bStart, bEnd);

  const daysA = Math.max(1, Math.round((startOfDay(aEnd)-startOfDay(aStart))/(24*3600*1000))+1);
  const daysB = Math.max(1, Math.round((startOfDay(bEnd)-startOfDay(bStart))/(24*3600*1000))+1);
  const ppdA = A.pages/daysA;
  const ppdB = B.pages/daysB;

  const sphA = speedPH(A);
  const sphB = speedPH(B);

  const ndA = A.pages>0 ? (A.notes/A.pages)*100 : 0;
  const ndB = B.pages>0 ? (B.notes/B.pages)*100 : 0;

  const text =
`[${labelA}] ${fmtDate(aStart)} → ${fmtDate(aEnd)}
- Pages: ${fmtDelta(A.pages, B.pages)}
- Books: ${fmtDelta(booksA, booksB)}
- Points: ${fmtDelta(pointsA, pointsB)}
- Pages/day: ${ppdA.toFixed(1)} (${(() => { const p=pctChange(ppdA,ppdB); return p===null?"mới":`${p>0?"+":""}${p.toFixed(0)}%`; })()})
- Speed (pages/hour): ${sphA>0?sphA.toFixed(1):"—"} (${(() => { const p=pctChange(sphA,sphB); return (sphA===0 && sphB===0)?"0%":(p===null?"mới":`${p>0?"+":""}${p.toFixed(0)}%`); })()})
- Notes/100 pages: ${A.pages>0?ndA.toFixed(1):"—"} (${(() => { const p=pctChange(ndA,ndB); return (A.pages===0 && B.pages===0)?"0%":(p===null?"mới":`${p>0?"+":""}${p.toFixed(0)}%`); })()})

[${labelB}] ${fmtDate(bStart)} → ${fmtDate(bEnd)}
- Pages: ${B.pages}
- Books: ${booksB}
- Points: ${pointsB}
- Pages/day: ${ppdB.toFixed(1)}
- Speed (pages/hour): ${sphB>0?sphB.toFixed(1):"—"}
- Notes/100 pages: ${B.pages>0?ndB.toFixed(1):"—"}

Insight:
${compareInsight(A,B,booksA,booksB,pointsA,pointsB,ndA,ndB,sphA,sphB)}`;

  return text;
}

function compareInsight(A,B,booksA,booksB,pointsA,pointsB,ndA,ndB,sphA,sphB){
  let lines = [];
  const dp = A.pages - B.pages;
  if (dp > 0) lines.push(`- Tăng ${dp} trang. Tốt. Nhưng coi note/speed có giữ chất không.`);
  if (dp < 0) lines.push(`- Giảm ${Math.abs(dp)} trang. Lý do? Lịch bận hay lười? Chọn 1 và xử lý.`);
  if (ndA < ndB && A.pages > 0) lines.push(`- Notes density giảm → có dấu hiệu đọc lướt. Chốt rule: mỗi session phải có 1 note.`);
  if (sphA > 0 && sphB > 0 && sphA - sphB > 15) lines.push(`- Tốc độ tăng mạnh. Nếu hiểu vẫn ổn thì ok; nếu không, giảm speed 10–15%.`);
  if (booksA < booksB) lines.push(`- Số quyển hoàn thành giảm. Nếu tuần vẫn đủ 500 trang thì không sao; nếu muốn bám 2 quyển/tuần thì ưu tiên quyển mỏng.`);
  if (pointsA < pointsB) lines.push(`- Điểm giảm → nhịp log/đọc giảm.`);
  if (lines.length === 0) lines.push(`- Khá ổn, không đổi lớn. Muốn bật level thì tăng note density và giữ 500 trang/tuần.`);
  return lines.join("\n");
}

function doCompareWoW(){
  const now = new Date();
  const cur = weekRange(now, state.settings.weekStart);
  const prevEnd = new Date(cur.start); prevEnd.setDate(prevEnd.getDate()-1);
  const prevStart = new Date(cur.start); prevStart.setDate(prevStart.getDate()-7);

  $("compareQuick").textContent = compareRanges(
    "Tuần này", cur.start, cur.end,
    "Tuần trước", prevStart, prevEnd
  );
}

function doCompareMoM(){
  const now = new Date();
  const cur = monthRange(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth()-1, 15);
  const prev = monthRange(prevDate);

  $("compareQuick").textContent = compareRanges(
    "Tháng này", cur.start, cur.end,
    "Tháng trước", prev.start, prev.end
  );
}

function doCompareCustom(){
  const aS = $("aStart").value, aE = $("aEnd").value, bS = $("bStart").value, bE = $("bEnd").value;
  if (!aS || !aE || !bS || !bE) return alert("Chọn đủ 4 ngày.");
  const aStart = parseDate(aS), aEnd = parseDate(aE), bStart = parseDate(bS), bEnd = parseDate(bE);
  if (aEnd < aStart || bEnd < bStart) return alert("Range end phải >= start.");
  $("compareCustom").textContent = compareRanges("Range A", aStart, aEnd, "Range B", bStart, bEnd);
}

/* ------------------------ Backup / Restore ------------------------ */
function openDataModal(){
  $("modalData").classList.remove("hidden");
  $("dataArea").value = "";
}
function closeDataModal(){
  $("modalData").classList.add("hidden");
}
function exportData(){
  $("dataArea").value = JSON.stringify(state, null, 2);
  $("dataArea").focus();
}
function importData(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(String(reader.result));
      state = { ...structuredClone(DEFAULT_STATE), ...obj };
      saveState();
      closeDataModal();
      renderAll();
      alert("Import OK");
    } catch {
      alert("JSON lỗi.");
    }
  };
  reader.readAsText(file);
}

/* ------------------------ Safety helpers ------------------------ */
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ------------------------ Init / Events ------------------------ */
function bindEvents(){
  // tabs
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  // mode
  document.querySelectorAll("[data-mode]").forEach(btn => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

  // quick pages
  document.querySelectorAll("[data-pages]").forEach(btn => btn.addEventListener("click", () => logPages(Number(btn.dataset.pages))));

  $("btnCustomLog").onclick = () => openLogModal(null);
  $("closeLog").onclick = closeLogModal;
  $("cancelLog").onclick = closeLogModal;
  $("submitLog").onclick = submitCustomLog;

  $("btnAddBook").onclick = addBook;
  $("btnFilterAll").onclick = () => { state.ui.bookFilter="all"; renderAll(); };
  $("btnFilterReading").onclick = () => { state.ui.bookFilter="reading"; renderAll(); };
  $("btnFilterFinished").onclick = () => { state.ui.bookFilter="finished"; renderAll(); };

  // compare
  $("btnWoW").onclick = doCompareWoW;
  $("btnMoM").onclick = doCompareMoM;
  $("btnCompareCustom").onclick = doCompareCustom;
  $("btnSwap").onclick = () => {
    const aS = $("aStart").value, aE = $("aEnd").value, bS = $("bStart").value, bE = $("bEnd").value;
    $("aStart").value = bS; $("aEnd").value = bE; $("bStart").value = aS; $("bEnd").value = aE;
  };

  // settings
  $("btnSaveSettings").onclick = () => {
    state.settings.weeklyPages = Number($("gWeeklyPages").value) || 500;
    state.settings.weeklyBooks = Number($("gWeeklyBooks").value) || 2;
    state.settings.monthlyBooks = Number($("gMonthlyBooks").value) || 8;
    state.settings.yearlyBooks = Number($("gYearlyBooks").value) || 96;
    state.settings.dailyMinPages = Number($("gDailyMin").value) || 20;
    state.settings.weekStart = Number($("gWeekStart").value);
    saveState();
    renderAll();
    alert("Saved.");
  };

  $("btnReset").onclick = () => {
    if (!confirm("Reset toàn bộ dữ liệu?")) return;
    state = structuredClone(DEFAULT_STATE);
    saveState();
    renderAll();
  };

  // data modal
  $("btnBackup").onclick = openDataModal;
  $("closeData").onclick = closeDataModal;
  $("btnExport").onclick = exportData;
  $("fileImport").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importData(f);
    e.target.value = "";
  });

  // register sw
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
  }
}

function seedIfEmpty(){
  if (state.books.length === 0) {
    state.books.push({ id: uid(), title:"Atomic Habits", author:"James Clear", totalPages: 320, status:"reading", startDate: fmtDate(new Date()), endDate: null });
    saveState();
  }
}

function initCustomCompareDates(){
  const today = new Date();
  const curW = weekRange(today, state.settings.weekStart);
  const prevEnd = new Date(curW.start); prevEnd.setDate(prevEnd.getDate()-1);
  const prevStart = new Date(curW.start); prevStart.setDate(prevStart.getDate()-7);

  $("aStart").value = fmtDate(curW.start);
  $("aEnd").value = fmtDate(curW.end);
  $("bStart").value = fmtDate(prevStart);
  $("bEnd").value = fmtDate(prevEnd);
}

function init(){
  seedIfEmpty();
  bindEvents();
  initCustomCompareDates();
  renderAll();
}

init();
