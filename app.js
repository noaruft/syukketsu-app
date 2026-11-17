"use strict";
// ===== データ =====
const KEY = "kessoku.v1";
const STATUS = { present: "出席", late: "遅刻", early: "早退", lateEarly: "遅早", absent: "欠席", excluded: "忌引・出停等", none: "休講（授業なし）" };
const OFF_REASONS = ["休校・祝日", "テスト日", "学校行事", "その他"];
const WEEK = [[2, "月曜"], [3, "火曜"], [4, "水曜"], [5, "木曜"], [6, "金曜"], [7, "土曜"]];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

const SAMPLE = [["文学国語", 38, 2], ["古典B", 71, 4], ["世界史探究", 53, 5], ["政治・経済", 37, 4], ["数学演習", 54, 4],
  ["理科基礎演習", 58, 4], ["体育", 33, 2], ["英語コミュニケーションIII", 54, 6], ["論理・表現III", 37, 1], ["LHR", 98, 17]];
// 令和8年度の時間割（A週・B週は理科基礎演習に換算すると同じ）。曜日(1=日…7=土) → {時限: SAMPLE の番号}
const SAMPLE_TT = { 2: { 1: 2, 2: 4, 3: 0, 4: 7, 6: 1 }, 3: { 1: 1, 2: 5, 3: 7, 4: 8, 5: 3, 7: 2 }, 4: { 1: 3, 3: 5, 4: 7 },
  5: { 2: 1, 3: 0, 4: 8, 5: 5, 6: 4 }, 6: { 2: 2, 3: 4, 4: 1, 5: 6, 6: 6, 7: 9 } };

const newSubject = () => ({ id: uid(), name: "", total: 0, absent: 0, late: 0, early: 0, lateEarly: 0, excluded: 0, den: null });

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.subjects) return d; } catch (e) {}
  return { subjects: [], slots: [], records: [], den: 3, off: {} };
}
let S = load();
S.off = S.off || {};
let tab = "subjects";
let date = todayStr();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

function loadSample() {
  S.subjects = SAMPLE.map(([name, total, absent]) => ({ ...newSubject(), name, total, absent }));
  S.slots = [];
  for (const [wd, ps] of Object.entries(SAMPLE_TT))
    for (const [p, i] of Object.entries(ps)) S.slots.push({ wd: +wd, period: +p, sid: S.subjects[i].id });
  S.records = []; S.off = {};
  save();
}

// ===== 計算（学校の出欠表と同じ考え方） =====
function effective(s) {
  const e = { ...s };
  for (const r of S.records) {
    if (r.sid !== s.id) continue;
    if (r.status === "late") e.late++;
    else if (r.status === "early") e.early++;
    else if (r.status === "lateEarly") e.lateEarly++;
    else if (r.status === "absent") e.absent++;
    else if (r.status === "excluded") e.excluded++;
  }
  return e;
}
function calc(s) {
  const e = effective(s);
  const converted = Math.floor((e.late + e.early + e.lateEarly) / 3);
  const missed = e.absent + converted;
  const required = Math.max(0, e.total - e.excluded);
  const rate = required > 0 ? missed / required : 0;
  const n = Math.max(1, s.den || S.den);
  const max = Math.floor(required / n);
  const remaining = max - missed;
  const danger = remaining < 0 ? "over" : remaining <= 1 ? "critical" : remaining <= 3 ? "caution" : "safe";
  return { converted, missed, required, rate, max, remaining, danger };
}
const DANGER = { safe: "余裕", caution: "注意", critical: "あと少し", over: "超過" };
const pct = r => Math.ceil(r * 100 - 1e-9) + "%";
const remainText = c => c.remaining >= 0 ? `あと ${c.remaining} 回` : `${-c.remaining} 回 超過`;
const fraction = n => (n === 2 ? "2分の1" : n + "分の1");

// ===== 日付・時間割 =====
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function weekdayOf(str) { const [y, m, d] = str.split("-").map(Number); return new Date(y, m - 1, d).getDay() + 1; }
const slotsOn = str => S.slots.filter(x => x.wd === weekdayOf(str)).sort((a, b) => a.period - b.period);
const statusOf = (day, period) => (S.records.find(r => r.day === day && r.period === period) || {}).status || "";
function setStatus(day, period, sid, status) {
  S.records = S.records.filter(r => !(r.day === day && r.period === period));
  if (status) S.records.push({ id: uid(), day, period, sid, status });
}
const nameOf = id => (S.subjects.find(s => s.id === id) || { name: "（削除された教科）" }).name;

// ===== 画面 =====
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function render() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("#view").innerHTML = { subjects: vSubjects, record: vRecord, timetable: vTimetable, settings: vSettings }[tab]();
}

function vSubjects() {
  let h = `<div class="toolbar"><span></span><button class="icon-btn" data-act="add" aria-label="教科を追加">＋</button></div><h1>あと何回休める？</h1>`;
  if (!S.subjects.length)
    return h + `<div class="empty">教科がありません<br>右上の＋から追加するか、サンプルで試せます。<br><button class="btn" data-act="sample">サンプルを読み込む</button></div>`;
  const ranked = S.subjects.map(s => [s, calc(s)]).sort((a, b) => a[1].remaining - b[1].remaining);
  const [ws, wc] = ranked[0];
  const over = ranked.filter(x => x[1].danger === "over").length;
  h += `<div class="card"><div class="row"><div class="grow"><div class="sub">いちばん余裕がない教科</div><b>${esc(ws.name)}</b>${over ? `<div class="sub critical">⚠ ${over} 教科が上限を超えています</div>` : ""}</div><b class="${wc.danger}" style="font-size:20px">${remainText(wc)}</b></div></div>`;
  h += `<h2>教科ごと</h2><div class="card">`;
  for (const s of S.subjects) {
    const c = calc(s);
    const w = c.max > 0 ? Math.min(100, Math.max(0, (c.missed / c.max) * 100)) : 100;
    h += `<div class="row" data-act="edit" data-id="${s.id}"><div class="grow"><b>${esc(s.name)}</b><div class="sub">欠課 ${c.missed} / 出席すべき ${c.required}　欠席率 ${pct(c.rate)}</div><div class="bar"><i class="${c.danger}" style="width:${w}%"></i></div></div>
      <div class="big ${c.danger}"><small>${c.remaining >= 0 ? "あと" : "超過"}</small><b>${Math.abs(c.remaining)}</b><small>回</small></div>
      <span class="badge ${c.danger}">${DANGER[c.danger]}</span></div>`;
  }
  return h + `</div>`;
}

function vRecord() {
  const slots = slotsOn(date);
  let h = `<h1>出欠の記録</h1><div class="card"><div class="row"><span class="grow">日付</span><input type="date" id="date" value="${date}"></div></div>`;
  if (S.off[date] !== undefined)
    return h + `<h2>この日は授業なし</h2><div class="card"><div class="row"><span class="grow"><b>🚫 ${esc(S.off[date])}</b><div class="sub">欠席にも出席にも数えません。</div></div></div><div class="btns"><button class="btn" data-act="offclear">授業ありに戻す</button></div></div>`;
  if (!slots.length)
    return h + `<div class="card" style="margin-top:14px"><div class="row"><span class="grow">理由</span><select id="offreason">${OFF_REASONS.map(r => `<option>${r}</option>`).join("")}</select></div><div class="btns"><button class="btn" data-act="off">🚫 この日は授業なし</button></div></div><p class="note">この曜日の時間割がありません。「時間割」タブで登録してください。</p>`;
  h += `<h2>まとめて入力</h2><div class="card"><div class="btns">
    <button class="btn red" data-act="day" data-st="absent">🛏 丸一日 欠席にする</button>
    <button class="btn" data-act="day" data-st="present">✓ 全コマ 出席にする</button>
    <button class="btn" data-act="day" data-st="excluded">丸一日 忌引・出停等（出席すべき時数から除く）</button>
    <button class="btn plain" data-act="day" data-st="">全コマ 記録を消す</button></div></div>
    <h2>授業がない日</h2><div class="card"><div class="row"><span class="grow">理由</span><select id="offreason">${OFF_REASONS.map(r => `<option>${r}</option>`).join("")}</select></div>
    <div class="btns"><button class="btn" data-act="off">🚫 この日は授業なし</button></div></div>
    <p class="note">休校・祝日・テスト日など、その日の授業を出欠に数えない日です。1コマだけの休講は、コマごとの選択で「休講（授業なし）」を選びます。</p>`;
  h += `<h2>コマごと</h2><div class="card day-slot">`;
  for (const sl of slots) {
    const cur = statusOf(date, sl.period);
    h += `<div class="row"><span class="sub" style="width:34px">${sl.period}限</span><span class="grow">${esc(nameOf(sl.sid))}</span>
      <select class="${cur}" data-act="slot" data-p="${sl.period}" data-sid="${sl.sid}"><option value="">未記録</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${v}</option>`).join("")}</select></div>`;
  }
  return h + `</div>`;
}

function vTimetable() {
  let h = `<h1>時間割</h1>`;
  if (!S.subjects.length) h += `<p class="note">先に「教科」タブで教科を追加してください。</p>`;
  for (const [wd, label] of WEEK) {
    h += `<h2>${label}</h2><div class="card">`;
    for (const p of PERIODS) {
      const cur = (S.slots.find(x => x.wd === wd && x.period === p) || {}).sid || "";
      h += `<div class="row"><span class="grow">${p}限</span><select data-act="tt" data-wd="${wd}" data-p="${p}"><option value="">なし</option>${S.subjects.map(s => `<option value="${s.id}"${s.id === cur ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>`;
    }
    h += `</div>`;
  }
  return h;
}

function vSettings() {
  return `<h1>設定</h1><h2>欠席の上限</h2><div class="card"><div class="row"><span class="grow">全体の上限</span>
    <select data-act="den">${[2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === S.den ? " selected" : ""}>${fraction(n)}</option>`).join("")}</select></div></div>
    <p class="note">欠課合計が「出席すべき時数」のこの割合を超えると単位不認定になる、という一般的な高校のルールです（既定は3分の1）。教科ごとに別の値も選べます。学校の規則を確認して合わせてください。</p>
    <h2>色の目安（あと何回休めるか）</h2><div class="card">
    <div class="row"><span class="safe">●</span><span class="grow">余裕</span><span class="sub">4回以上</span></div>
    <div class="row"><span class="caution">●</span><span class="grow">注意</span><span class="sub">2〜3回</span></div>
    <div class="row"><span class="critical">●</span><span class="grow">あと少し</span><span class="sub">0〜1回</span></div>
    <div class="row"><span class="over">●</span><span class="grow">超過</span><span class="sub">上限を超えた</span></div></div>
    <h2>データ</h2><div class="card"><div class="btns">
    <button class="btn" data-act="sample">サンプル（出欠表の例・時間割つき）を読み込む</button>
    <button class="btn" data-act="export">バックアップを書き出す</button>
    <button class="btn" data-act="import">バックアップを読み込む</button>
    <button class="btn plain" data-act="reset">すべてのデータを消す</button></div></div>
    <p class="note">計算は学校の出欠表と同じ考え方です：換算欠席＝遅刻・早退・遅早の合計÷3（切り捨て）、欠課合計＝欠席＋換算欠席。データはこの端末のブラウザの中だけに保存され、外には送られません。機種変更のときは「バックアップを書き出す」で保存してください。</p>`;
}

// ===== 教科の編集シート =====
let draft = null, draftIsNew = false;
function openSheet(s, isNew) { draft = { ...s }; draftIsNew = isNew; renderSheet(); $("#sheet").hidden = false; }
function closeSheet() { $("#sheet").hidden = true; draft = null; render(); }
function stepper(field, label, max = 500) {
  return `<div class="row"><span class="grow">${label}</span><div class="step"><button data-act="step" data-f="${field}" data-d="-1"${draft[field] <= 0 ? " disabled" : ""}>−</button><span>${draft[field]}</span><button data-act="step" data-f="${field}" data-d="1">＋</button></div></div>`;
}
function renderSheet() {
  const keep = $("#sheet");
  const scroll = keep.scrollTop;
  const c = calc(draft);
  const recCount = S.records.filter(r => r.sid === draft.id).length;
  const ok = draft.name.trim().length > 0;
  keep.innerHTML = `<div><div class="sheet-head"><button data-act="cancel">キャンセル</button><b>${draftIsNew ? "教科を追加" : "教科を編集"}</b><button data-act="save"${ok ? "" : " disabled"}>保存</button></div>
  <h2>教科</h2><div class="card"><div class="row"><input type="text" id="name" placeholder="教科名（例：古典B）" value="${esc(draft.name)}"></div>${stepper("total", "総授業時数")}</div>
  <h2>これまでの累計</h2><div class="card">${stepper("absent", "欠席")}${stepper("late", "遅刻")}${stepper("early", "早退")}${stepper("lateEarly", "遅早")}${stepper("excluded", "忌引・出停・留学（除く時数）")}</div>
  <p class="note">記録タブで付けた毎回の出欠は、ここに自動で足されます。アプリを使い始める前の分だけを入れてください。</p>
  <h2>計算結果</h2><div class="card">
  ${[["日々の記録の件数", recCount], ["換算欠席（遅刻・早退・遅早 3回＝1回）", c.converted], ["欠課合計", c.missed], ["出席すべき時数", c.required], ["欠席率", pct(c.rate)], ["休める上限", c.max + " 回"]].map(([k, v]) => `<div class="row"><span class="grow">${k}</span><span class="sub" style="font-size:15px">${v}</span></div>`).join("")}
  <div class="row"><span class="grow">あと何回休める？</span><b class="${c.danger}">${remainText(c)}</b></div></div>
  <h2>この教科の上限</h2><div class="card"><div class="row"><span class="grow">上限</span><select data-act="dsel"><option value="">全体設定（${fraction(S.den)}）</option>${[2, 3, 4, 5, 6].map(n => `<option value="${n}"${draft.den === n ? " selected" : ""}>${fraction(n)}</option>`).join("")}</select></div></div>
  ${draftIsNew ? "" : `<div class="card" style="margin-top:22px"><div class="btns"><button class="btn plain" data-act="del">この教科を削除</button></div></div>`}</div>`;
  keep.scrollTop = scroll;
}

// ===== 操作 =====
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab],[data-act]");
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.act;
  if (a === "add") openSheet(newSubject(), true);
  else if (a === "edit") openSheet(S.subjects.find(s => s.id === t.dataset.id), false);
  else if (a === "sample") { if (!S.subjects.length || confirm("今の教科・時間割・記録をサンプルで置き換えますか？")) { loadSample(); render(); } }
  else if (a === "off") { S.off[date] = $("#offreason").value; S.records = S.records.filter(r => r.day !== date); save(); render(); }
  else if (a === "offclear") { delete S.off[date]; save(); render(); }
  else if (a === "day") { for (const sl of slotsOn(date)) setStatus(date, sl.period, sl.sid, t.dataset.st); save(); render(); }
  else if (a === "step") { const f = t.dataset.f; draft[f] = Math.max(0, Math.min(500, draft[f] + +t.dataset.d)); draft.name = ($("#name") || { value: draft.name }).value; renderSheet(); }
  else if (a === "cancel") closeSheet();
  else if (a === "save") {
    draft.name = $("#name").value.trim();
    const i = S.subjects.findIndex(s => s.id === draft.id);
    if (i >= 0) S.subjects[i] = draft; else S.subjects.push(draft);
    save(); closeSheet();
  } else if (a === "del") {
    if (!confirm(`「${draft.name}」を削除しますか？ 時間割と記録も消えます。`)) return;
    S.subjects = S.subjects.filter(s => s.id !== draft.id);
    S.slots = S.slots.filter(x => x.sid !== draft.id); S.records = S.records.filter(r => r.sid !== draft.id);
    save(); closeSheet();
  } else if (a === "export") {
    const blob = new Blob([JSON.stringify(S)], { type: "application/json" });
    const l = document.createElement("a"); l.href = URL.createObjectURL(blob); l.download = `kessoku-backup-${todayStr()}.json`; l.click();
  } else if (a === "import") {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
    inp.onchange = async () => {
      try { const d = JSON.parse(await inp.files[0].text()); if (!d.subjects || !d.slots || !d.records) throw 0; if (!confirm("今のデータをバックアップで置き換えますか？")) return; S = d; S.off = S.off || {}; save(); render(); }
      catch (err) { alert("読み込めませんでした。このアプリで書き出したバックアップを選んでください。"); }
    };
    inp.click();
  } else if (a === "reset") { if (confirm("すべてのデータを消します。よろしいですか？")) { S = { subjects: [], slots: [], records: [], den: 3, off: {} }; save(); render(); } }
});

document.addEventListener("change", e => {
  const t = e.target, a = t.dataset.act;
  if (t.id === "date") { if (t.value) { date = t.value; render(); } return; }
  if (a === "slot") { setStatus(date, +t.dataset.p, t.dataset.sid, t.value); save(); render(); }
  else if (a === "tt") {
    S.slots = S.slots.filter(x => !(x.wd === +t.dataset.wd && x.period === +t.dataset.p));
    if (t.value) S.slots.push({ wd: +t.dataset.wd, period: +t.dataset.p, sid: t.value });
    save();
  } else if (a === "den") { S.den = +t.value; save(); }
  else if (a === "dsel") { draft.den = t.value ? +t.value : null; draft.name = $("#name").value; renderSheet(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "name" && draft) { draft.name = e.target.value; const b = document.querySelector('[data-act="save"]'); if (b) b.disabled = !draft.name.trim(); }
});

render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
