import { db } from './firebase.js';
import { DEFAULT_UNITS } from './units.js';
import {
  collection, doc, addDoc, getDocs, getDoc, setDoc, deleteDoc, query, where, orderBy
} from 'firebase/firestore';

// ========== 狀態 ==========
let units = [];
let currentTab = 'pay';

async function loadUnits() {
  const snap = await getDocs(collection(db, 'units'));
  if (snap.empty) {
    // 初次使用，寫入預設住戶
    for (const u of DEFAULT_UNITS) {
      await setDoc(doc(db, 'units', u.unit), u);
    }
    units = [...DEFAULT_UNITS];
  } else {
    units = snap.docs.map(d => d.data());
    units.sort((a, b) => DEFAULT_UNITS.findIndex(x=>x.unit===a.unit) - DEFAULT_UNITS.findIndex(x=>x.unit===b.unit));
  }
}

// ========== 工具 ==========
function rocNow() {
  const now = new Date();
  return { year: now.getFullYear() - 1911, month: now.getMonth() + 1 };
}

function isLate(payDateStr, feeYear, feeMonth) {
  try {
    const p = payDateStr.split('/');
    if (p.length < 3) return false;
    const pd = parseInt(p[0]) * 10000 + parseInt(p[1]) * 100 + parseInt(p[2]);
    const due = parseInt(feeYear) * 10000 + parseInt(feeMonth) * 100 + 10;
    return pd > due;
  } catch { return false; }
}

function showMsg(id, text, isOk) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'msg ' + (isOk ? 'msg-ok' : 'msg-err');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
}

// ========== 渲染 APP ==========
function renderApp() {
  const { year, month } = rocNow();
  document.getElementById('app').innerHTML = `
    <div class="header">
      <div>
        <h1>🏢 泰慶天廈管委會系統</h1>
        <p>資料即時同步至雲端</p>
      </div>
    </div>
    <div class="tabs">
      <button class="tab active" onclick="switchTab('pay')">📝 登記繳費</button>
      <button class="tab" onclick="switchTab('finance')">💰 收支記帳</button>
      <button class="tab" onclick="switchTab('query')">🔍 查詢狀況</button>
      <button class="tab" onclick="switchTab('report')">📊 產生報表</button>
      <button class="tab" onclick="switchTab('settings')">⚙️ 住戶設定</button>
    </div>

    <div id="page-pay" class="page active">${renderPayPage(year, month)}</div>
    <div id="page-finance" class="page">${renderFinancePage(year, month)}</div>
    <div id="page-query" class="page">${renderQueryPage(year)}</div>
    <div id="page-report" class="page">${renderReportPage(year, month)}</div>
    <div id="page-settings" class="page">${renderSettingsPage()}</div>
  `;
  bindPayEvents();
  bindFinanceEvents();
  loadPaySummary(year, month);
  loadFinanceList(year, month);
  loadQuery(year);
  loadSummaryTable(year);
  loadSettingsTable();
}

window.switchTab = function(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab')[['pay','finance','query','report','settings'].indexOf(t)].classList.add('active');
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + t).classList.add('active');
}

// ========== 登記繳費 ==========
function renderPayPage(year, month) {
  const unitOpts = units.map(u =>
    `<option value="${u.unit}" data-fee="${u.fee}">${u.unit}（${u.vacant ? '空戶' : u.fee + '元'}）</option>`
  ).join('');
  let monthOpts = '';
  for (let y = year; y >= year - 1; y--) {
    for (let m = 12; m >= 1; m--) {
      monthOpts += `<option value="${y}-${String(m).padStart(2,'0')}">${y}年${m}月</option>`;
    }
  }
  return `
    <div class="grid2">
      <div class="card">
        <div class="card-title">登記繳費</div>
        <label>選擇住戶</label>
        <select id="pay-unit"><option value="">-- 請選擇 --</option>${unitOpts}</select>
        <label>繳費月份（按住 Ctrl 可多選）</label>
        <select id="pay-months" multiple>${monthOpts}</select>
        <div class="fee-box" id="fee-display">請先選擇住戶和月份</div>
        <div class="grid2" style="margin-top:0">
          <div><label>繳費日期（民國）</label><input type="text" id="pay-date" placeholder="115/2/6"></div>
          <div><label>收據編號</label><input type="text" id="pay-receipt" placeholder="11786"></div>
        </div>
        <label>備註（選填）</label>
        <input type="text" id="pay-note" placeholder="如：分攤費抵扣">
        <button class="btn btn-primary btn-full" id="pay-submit">確認登記</button>
        <div id="pay-msg"></div>
      </div>
      <div class="card">
        <div class="card-title">本月繳費摘要</div>
        <div id="pay-stats" class="grid2" style="margin-bottom:12px"></div>
        <div id="pay-list" class="overflow-x"><div class="loading">載入中...</div></div>
      </div>
    </div>`;
}

function bindPayEvents() {
  const unitSel = document.getElementById('pay-unit');
  const monthSel = document.getElementById('pay-months');
  if (!unitSel) return;
  unitSel.addEventListener('change', updateFeeDisplay);
  monthSel.addEventListener('change', updateFeeDisplay);
  document.getElementById('pay-submit').addEventListener('click', submitPayment);
}

function updateFeeDisplay() {
  const unitSel = document.getElementById('pay-unit');
  const months = Array.from(document.getElementById('pay-months').selectedOptions);
  const u = units.find(x => x.unit === unitSel.value);
  const el = document.getElementById('fee-display');
  if (!u) { el.textContent = '請先選擇住戶和月份'; return; }
  if (!months.length) { el.textContent = `每月 ${u.fee} 元，請選擇月份`; return; }
  el.textContent = `應繳 ${(u.fee * months.length).toLocaleString()} 元（${u.fee} × ${months.length} 個月）`;
}

async function submitPayment() {
  const unit = document.getElementById('pay-unit').value;
  const months = Array.from(document.getElementById('pay-months').selectedOptions).map(o => o.value);
  const payDate = document.getElementById('pay-date').value.trim();
  const receipt = document.getElementById('pay-receipt').value.trim();
  const note = document.getElementById('pay-note').value.trim();
  if (!unit) return showMsg('pay-msg', '請選擇住戶', false);
  if (!months.length) return showMsg('pay-msg', '請選擇月份', false);
  if (!payDate) return showMsg('pay-msg', '請填入繳費日期', false);
  if (!receipt) return showMsg('pay-msg', '請填入收據編號', false);
  const u = units.find(x => x.unit === unit);
  const fee = u ? u.fee : 1500;
  const btn = document.getElementById('pay-submit');
  btn.textContent = '登記中...'; btn.disabled = true;
  try {
    const groupId = `g${Date.now()}`;
const groupMonths = months.map(m => parseInt(m.split('-')[1]));
const groupStartMonth = Math.min(...groupMonths);
const groupEndMonth = Math.max(...groupMonths);
const totalFee = fee * months.length;
for (const m of months) {
  const [y, mo] = m.split('-');
  const late = isLate(payDate, y, mo);
  const isFirst = parseInt(mo) === groupStartMonth;
  await addDoc(collection(db, 'payments'), {
    unit, year: parseInt(y), month: parseInt(mo), payDate, receipt,
    fee: isFirst ? totalFee : 0,
    actualFee: totalFee,
    late, note, groupId,
    groupStartMonth, groupEndMonth,
    ts: new Date().toISOString()
  });
}
    showMsg('pay-msg', `登記成功！${unit} 共 ${(fee * months.length).toLocaleString()} 元`, true);
    document.getElementById('pay-unit').value = '';
    document.getElementById('pay-months').selectedIndex = -1;
    document.getElementById('pay-date').value = '';
    document.getElementById('pay-receipt').value = '';
    document.getElementById('pay-note').value = '';
    document.getElementById('fee-display').textContent = '請先選擇住戶和月份';
    const { year, month } = rocNow();
    loadPaySummary(year, month);
  } catch (e) {
    showMsg('pay-msg', '錯誤：' + e.message, false);
  }
  btn.textContent = '確認登記'; btn.disabled = false;
}

async function loadPaySummary(year, month) {
  const el = document.getElementById('pay-list');
  const statsEl = document.getElementById('pay-stats');
  if (!el) return;
  const q = query(collection(db, 'payments'), where('year', '==', year), where('month', '==', month));
  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const total = list.reduce((s, p) => s + p.fee, 0);
  const lateCount = list.filter(p => p.late).length;
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">${year}年${month}月收入</div><div class="stat-val">${total.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">遲交筆數</div><div class="stat-val" style="color:${lateCount > 0 ? '#c62828' : '#2e7d32'}">${lateCount}</div></div>`;
  if (!list.length) { el.innerHTML = '<div class="empty">本月尚無繳費記錄</div>'; return; }
  el.innerHTML = `<table><tr><th>住戶</th><th>日期</th><th>收據</th><th>金額</th><th>狀態</th></tr>
    ${list.slice().reverse().map(p => `<tr class="${p.late ? 'row-late' : ''}">
      <td>${p.unit}</td><td>${p.payDate}</td><td>${p.receipt}</td>
      <td>${p.fee.toLocaleString()}</td>
      <td><span class="badge ${p.late ? 'badge-late' : 'badge-ok'}">${p.late ? '遲交' : '準時'}</span></td>
    </tr>`).join('')}</table>`;
}

// ========== 收支記帳 ==========
function renderFinancePage(year, month) {
  return `
    <div class="grid2">
      <div class="card">
        <div class="card-title">新增收支</div>
        <label>類型</label>
        <select id="fin-type">
          <option value="收入">收入（管理費以外）</option>
          <option value="支出">支出</option>
        </select>
        <label>項目</label>
        <div class="preset-row" id="fin-presets"></div>
        <input type="text" id="fin-item" placeholder="輸入或點選快捷項目">
        <div class="grid2">
          <div><label>金額（元）</label><input type="number" id="fin-amount" placeholder="1000"></div>
          <div><label>年份（民國）</label><input type="number" id="fin-year" value="${year}"></div>
        </div>
        <div class="grid2">
          <div><label>月份</label><input type="number" id="fin-month" value="${month}" min="1" max="12"></div>
          <div><label>日期（幾號）</label><input type="number" id="fin-day" placeholder="6" min="1" max="31"></div>
        </div>
        <label>收據/單號（選填）</label>
        <input type="text" id="fin-receipt">
        <button class="btn btn-primary btn-full" id="fin-submit">確認登記</button>
        <div id="fin-msg"></div>
      </div>
      <div class="card">
        <div class="card-title">收支記錄</div>
        <div class="grid2" style="margin-bottom:10px">
          <div><label>篩選年份</label><input type="number" id="fin-filter-year" value="${year}"></div>
          <div><label>篩選月份</label><input type="number" id="fin-filter-month" value="${month}" min="1" max="12"></div>
        </div>
        <button class="btn" style="margin-bottom:10px" onclick="reloadFinanceList()">套用篩選</button>
        <div id="fin-list" class="overflow-x"><div class="loading">載入中...</div></div>
      </div>
    </div>`;
}

const incomePresets = ['倉庫租金', '磁扣購買', '感應卡', '停車費', '罰款', '其他'];
const expensePresets = ['物業費用', '水電費', '電話費', '例行保養', '修繕費', '行政雜支', '委員出席費', '其他'];

function bindFinanceEvents() {
  const typeEl = document.getElementById('fin-type');
  if (!typeEl) return;
  typeEl.addEventListener('change', updateFinPresets);
  updateFinPresets();
  document.getElementById('fin-submit').addEventListener('click', submitFinance);
}

window.reloadFinanceList = function() {
  const y = parseInt(document.getElementById('fin-filter-year').value);
  const m = parseInt(document.getElementById('fin-filter-month').value);
  loadFinanceList(y, m);
}

function updateFinPresets() {
  const type = document.getElementById('fin-type').value;
  const list = type === '收入' ? incomePresets : expensePresets;
  document.getElementById('fin-presets').innerHTML = list.map(p =>
    `<span class="preset-tag" onclick="document.getElementById('fin-item').value='${p}'">${p}</span>`
  ).join('');
}

async function submitFinance() {
  const type = document.getElementById('fin-type').value;
  const item = document.getElementById('fin-item').value.trim();
  const amount = parseFloat(document.getElementById('fin-amount').value);
  const day = document.getElementById('fin-day').value;
  const year = parseInt(document.getElementById('fin-year').value);
  const month = parseInt(document.getElementById('fin-month').value);
  const date = `${year}/${month}/${day}`;
  const receipt = document.getElementById('fin-receipt').value.trim();
  if (!item) return showMsg('fin-msg', '請填入項目', false);
  if (!amount || isNaN(amount)) return showMsg('fin-msg', '請填入正確金額', false);
  if (!day) return showMsg('fin-msg', '請填入日期（幾號）', false);
  if (!year || !month) return showMsg('fin-msg', '請填入年份和月份', false);
  const btn = document.getElementById('fin-submit');
  btn.textContent = '登記中...'; btn.disabled = true;
  try {
    await addDoc(collection(db, 'finances'), { type, item, amount, date, year, month, receipt, ts: new Date().toISOString() });
    showMsg('fin-msg', `登記成功！${type}：${item} ${amount.toLocaleString()} 元`, true);
    document.getElementById('fin-item').value = '';
    document.getElementById('fin-amount').value = '';
    document.getElementById('fin-day').value = '';
    loadFinanceList(year, month);
  } catch (e) {
    showMsg('fin-msg', '錯誤：' + e.message, false);
  }
  btn.textContent = '確認登記'; btn.disabled = false;
}

async function loadFinanceList(year, month) {
  const el = document.getElementById('fin-list');
  if (!el) return;
  const q = query(collection(db, 'finances'), where('year', '==', year), where('month', '==', month));
  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!list.length) { el.innerHTML = '<div class="empty">尚無記錄</div>'; return; }
  el.innerHTML = `<table><tr><th>日期</th><th>類型</th><th>項目</th><th>金額</th><th>單號</th><th></th></tr>
    ${list.slice().reverse().map(f => `<tr>
      <td>${f.date}</td>
      <td><span class="badge ${f.type === '收入' ? 'badge-income' : 'badge-expense'}">${f.type}</span></td>
      <td>${f.item}</td><td>${f.amount.toLocaleString()}</td><td>${f.receipt || ''}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteFinance('${f.id}',${year},${month})">刪</button></td>
    </tr>`).join('')}</table>`;
}

window.deleteFinance = async function(id, year, month) {
  if (!confirm('確定刪除此筆記錄？')) return;
  await deleteDoc(doc(db, 'finances', id));
  loadFinanceList(year, month);
}

// ========== 查詢 ==========
function renderQueryPage(year) {
  return `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div><label>查詢年份（民國）</label><input type="number" id="q-year" value="${year}" style="width:100px"></div>
        <div style="margin-top:16px"><button class="btn btn-primary" onclick="reloadQuery()">查詢</button></div>
        <div style="margin-top:16px;font-size:13px;color:#888">全年無遲交者，12月可享一個月管理費優惠</div>
      </div>
    </div>
    <div class="card">
      <div id="q-stats" class="grid3" style="margin-bottom:14px"></div>
      <div class="overflow-x"><div id="q-table"><div class="loading">載入中...</div></div></div>
    </div>`;
}

window.reloadQuery = function() {
  const y = parseInt(document.getElementById('q-year').value);
  loadQuery(y);
}

async function loadQuery(year) {
  const el = document.getElementById('q-table');
  const statsEl = document.getElementById('q-stats');
  if (!el) return;
  const snap = await getDocs(query(collection(db, 'payments'), where('year', '==', year)));
  const allPay = snap.docs.map(d => d.data());
  const lateMap = {}, paidMap = {};
  units.forEach(u => { lateMap[u.unit] = 0; paidMap[u.unit] = []; });
  allPay.forEach(p => {
    if (!paidMap[p.unit]) paidMap[p.unit] = [];
    paidMap[p.unit].push(p.month);
    if (p.late) lateMap[p.unit] = (lateMap[p.unit] || 0) + 1;
  });
  const paidCount = units.filter(u => paidMap[u.unit] && paidMap[u.unit].length > 0).length;
  const lateCount = units.filter(u => lateMap[u.unit] > 0).length;
  const discCount = units.filter(u => lateMap[u.unit] === 0 && paidMap[u.unit] && paidMap[u.unit].length > 0).length;
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">已繳費住戶</div><div class="stat-val">${paidCount}</div></div>
    <div class="stat"><div class="stat-label">有遲交記錄</div><div class="stat-val" style="color:#c62828">${lateCount}</div></div>
    <div class="stat"><div class="stat-label">可享12月優惠</div><div class="stat-val" style="color:#2e7d32">${discCount}</div></div>`;
  el.innerHTML = `<table><tr><th>住戶</th><th>已繳月份</th><th>遲交次數</th><th>12月優惠</th></tr>
    ${units.map(u => {
      const paid = (paidMap[u.unit] || []).sort((a, b) => a - b);
      const late = lateMap[u.unit] || 0;
      return `<tr class="${late > 0 ? 'row-late' : ''}">
        <td>${u.unit}</td>
        <td style="font-size:12px">${paid.length ? paid.map(m => m + '月').join('、') : '—'}</td>
        <td>${late > 0 ? `<span class="badge badge-late">${late}次</span>` : '0'}</td>
        <td><span class="badge ${late === 0 && paid.length > 0 ? 'badge-ok' : late > 0 ? 'badge-late' : 'badge-unpaid'}">
          ${late === 0 && paid.length > 0 ? '享有優惠' : late > 0 ? '無優惠' : '未繳費'}</span></td>
      </tr>`;
    }).join('')}</table>`;
}

// ========== 報表 ==========
function renderReportPage(year, month) {
  return `
    <div class="grid2">
      <div class="card">
        <div class="card-title">產生月報表</div>
        <div class="grid2">
          <div><label>年份（民國）</label><input type="number" id="rpt-year" value="${year}"></div>
          <div><label>月份</label><input type="number" id="rpt-month" value="${month}" min="1" max="12"></div>
        </div>
        <label>上月結餘（元）</label>
        <input type="number" id="rpt-prev" placeholder="578931">
        <button class="btn btn-primary btn-full" id="rpt-submit">產生並下載報表 (CSV)</button>
        <div id="rpt-msg"></div>
      </div>
      <div class="card">
        <div class="card-title">${year}年度月結算</div>
        <div class="overflow-x"><div id="summary-table"><div class="loading">載入中...</div></div></div>
      </div>
    </div>`;
}

document.addEventListener('click', e => {
  if (e.target.id === 'rpt-submit') generateReport();
});

async function generateReport() {
  const year = parseInt(document.getElementById('rpt-year').value);
  const month = parseInt(document.getElementById('rpt-month').value);
  const prev = parseFloat(document.getElementById('rpt-prev').value) || 0;
  if (!year || !month) return showMsg('rpt-msg', '請填入年份和月份', false);
  const btn = document.getElementById('rpt-submit');
  btn.textContent = '產生中...'; btn.disabled = true;
  try {
    const paySnap = await getDocs(query(collection(db, 'payments'), where('year', '==', year), where('month', '==', month)));
    const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', year), where('month', '==', month)));
    const pays = paySnap.docs.map(d => d.data());
    const fins = finSnap.docs.map(d => d.data());
    const mgmt = pays.reduce((s, p) => s + p.fee, 0);
    const otherInc = fins.filter(f => f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.type === '支出').reduce((s, f) => s + f.amount, 0);
    const totalInc = mgmt + otherInc;
    const net = totalInc - exp;
    const bal = prev + net;

    // 建立支出對照表
    const payMap = {};
    pays.forEach(p => { payMap[p.unit] = p; });

    // 用 SheetJS 建立 Excel
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    const wsData = [];

    // Row 1: 標題
    wsData.push([' ', `${year}年${month}月1日至${year}年${month}月${getLastDay(year,month)}日  泰慶天廈收支明細`]);

    // Row 2: 收入 + 上月結餘
    wsData.push([null, '(1)  收    入', null, null, null, null, null, null, null, null, null, 'A、上個月餘額：', null, null, prev]);

    // Row 3: 表頭
    wsData.push([null, '住戶', '繳交日期', '收據單號', '收費明細(管理費)', '金額', '住戶', '繳交日期', '收據單號', '收費明細(管理費)', '金額', '住戶', '繳交日期', '收據單號', '收費明細(管理費)', '金額']);

    // 分三欄放住戶
    const perCol = Math.ceil(units.length / 3);
    const col1 = units.slice(0, perCol);
    const col2 = units.slice(perCol, perCol * 2);
    const col3 = units.slice(perCol * 2);
    const maxRows = Math.max(col1.length, col2.length, col3.length);

    for (let i = 0; i < maxRows; i++) {
      const row = [null];
      // 欄1
      if (col1[i]) {
        const p = payMap[col1[i].unit];
        row.push(col1[i].unit, p ? p.payDate : null, p ? p.receipt : null, p ? `${year}年${month}月` : null, p ? p.fee : null);
      } else row.push(null,null,null,null,null);
      // 欄2
      if (col2[i]) {
        const p = payMap[col2[i].unit];
        row.push(col2[i].unit, p ? p.payDate : null, p ? p.receipt : null, p ? `${year}年${month}月` : null, p ? p.fee : null);
      } else row.push(null,null,null,null,null);
      // 欄3
      if (col3[i]) {
        const p = payMap[col3[i].unit];
        row.push(col3[i].unit, p ? p.payDate : null, p ? p.receipt : null, p ? `${year}年${month}月` : null, p ? p.fee : null);
      } else row.push(null,null,null,null,null);
      wsData.push(row);
    }

    // 管理費收入
    const mgmtRow = new Array(16).fill(null);
    mgmtRow[1] = 'B、管理費收入：'; mgmtRow[15] = mgmt;
    wsData.push(mgmtRow);

    // 其他收入
    const otherRow = new Array(16).fill(null);
    otherRow[6] = '其他收入：'; otherRow[9] = otherInc;
    // 收入原因
    const otherItems = fins.filter(f => f.type === '收入');
    const reasons = otherItems.map((f,i) => `${i+1}. ${f.item} ${f.amount}（${f.receipt||''}）`).join('\n');
    otherRow[6] = `其他收入：`;
    otherRow[9] = otherInc;
    wsData.push(otherRow);

    if (reasons) {
      const reasonRow = new Array(16).fill(null);
      reasonRow[1] = '收入原因：\n' + reasons;
      wsData.push(reasonRow);
    }

    // 收入合計
    const totalIncRow = new Array(16).fill(null);
    totalIncRow[11] = 'D、收入合計(B+C)：'; totalIncRow[14] = totalInc;
    wsData.push(totalIncRow);

    // 空行
    wsData.push([]);

    // 支出標題
    wsData.push([null, '(2)  支  出', null, null, null, null, null, null, null, null, null, '備註']);
    wsData.push([null, '日期', '支出明細(一)', null, null, '金額', '日期', '支出明細(二)', null, null, '金額', '# 灰色底為遲交管理費住戶，無12月份優惠。']);

    // 支出項目（分兩欄）
    const expItems = fins.filter(f => f.type === '支出');
    const expMid = Math.ceil(expItems.length / 2);
    const exp1 = expItems.slice(0, expMid);
    const exp2 = expItems.slice(expMid);
    const expMaxRows = Math.max(exp1.length, exp2.length);
    for (let i = 0; i < expMaxRows; i++) {
      const row = [null];
      if (exp1[i]) row.push(exp1[i].date, exp1[i].item, null, null, exp1[i].amount);
      else row.push(null,null,null,null,null);
      if (exp2[i]) row.push(exp2[i].date, exp2[i].item, null, null, exp2[i].amount);
      else row.push(null,null,null,null,null);
      wsData.push(row);
    }

    // 合計
    wsData.push([null, '合計：', null, null, null, exp1.reduce((s,f)=>s+f.amount,0), '合計：', null, null, null, exp2.reduce((s,f)=>s+f.amount,0)]);

    // 結算
    wsData.push([null, 'E、支出合計：', null, null, null, null, null, null, null, exp, null, '本期結餘(A+F)：', null, null, bal]);
    wsData.push([null, 'F、差異(D-E)：', null, null, null, null, null, null, null, net]);

    // 空行
    wsData.push([]);
    wsData.push([null, '主委：', null, null, null, null, '財務：', null, null, null, null, '製表人：']);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 欄寬設定（對應 B~P 欄）
    ws['!cols'] = [
      {wch:6},{wch:6},{wch:9},{wch:9},{wch:15},{wch:10},
      {wch:6},{wch:9},{wch:9},{wch:15},{wch:10},
      {wch:6},{wch:9},{wch:9},{wch:15},{wch:10}
    ];

    // 標題合併
    ws['!merges'] = [
      {s:{r:0,c:1}, e:{r:0,c:15}}, // 標題
    ];

    // 灰底標示遲交住戶
    for (let i = 0; i < maxRows; i++) {
      const rowIdx = i + 3;
      [[col1,1],[col2,6],[col3,11]].forEach(([col, colStart]) => {
        if (col[i]) {
          const p = payMap[col[i].unit];
          if (p && p.late) {
            for (let c = colStart; c < colStart+5; c++) {
              const cellRef = XLSX.utils.encode_cell({r:rowIdx, c});
              if (!ws[cellRef]) ws[cellRef] = {v:'', t:'s'};
              ws[cellRef].s = { fill: { fgColor: { rgb: 'D9D9D9' } } };
            }
          }
        }
      });
    }

    XLSX.utils.book_append_sheet(wb, ws, `${year}年${month}月`);
    XLSX.writeFile(wb, `${year}年${month}月_泰慶天廈收支明細.xlsx`);

    showMsg('rpt-msg', `報表已下載！本期結餘：${bal.toLocaleString()} 元`, true);
    loadSummaryTable(year);
  } catch (e) {
    showMsg('rpt-msg', '錯誤：' + e.message, false);
  }
  btn.textContent = '產生並下載報表 (xlsx)'; btn.disabled = false;
}

function getLastDay(rocYear, month) {
  return new Date(rocYear + 1911, month, 0).getDate();
}

async function loadSummaryTable(year) {
  const el = document.getElementById('summary-table');
  if (!el) return;
  const paySnap = await getDocs(query(collection(db, 'payments'), where('year', '==', year)));
  const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', year)));
  const pays = paySnap.docs.map(d => d.data());
  const fins = finSnap.docs.map(d => d.data());
  let html = '<table><tr><th>月份</th><th>管理費</th><th>其他收入</th><th>支出</th></tr>';
  let hasData = false;
  for (let m = 1; m <= 12; m++) {
    const mgmt = pays.filter(p => p.month === m).reduce((s, p) => s + p.fee, 0);
    const other = fins.filter(f => f.month === m && f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.month === m && f.type === '支出').reduce((s, f) => s + f.amount, 0);
    if (mgmt || other || exp) {
      hasData = true;
      html += `<tr><td>${year}年${m}月</td><td>${mgmt.toLocaleString()}</td><td>${other.toLocaleString()}</td><td>${exp.toLocaleString()}</td></tr>`;
    }
  }
  html += '</table>';
  el.innerHTML = hasData ? html : '<div class="empty">尚無資料</div>';
}

// ========== 住戶設定 ==========
function renderSettingsPage() {
  return `
    <div class="card">
      <div class="card-title">住戶管理費設定</div>
      <p style="font-size:13px;color:#888;margin-bottom:12px">修改金額後按「儲存」，空戶打勾後管理費標示為空戶</p>
      <div class="overflow-x"><div id="settings-table"><div class="loading">載入中...</div></div></div>
    </div>`;
}

async function loadSettingsTable() {
  const el = document.getElementById('settings-table');
  if (!el) return;
  el.innerHTML = `<table><tr><th>住戶</th><th>管理費（元）</th><th>空戶</th><th></th></tr>
    ${units.map((u, i) => `<tr>
      <td>${u.unit}</td>
      <td><input type="number" value="${u.fee}" id="fee-${i}" style="width:90px;padding:4px 8px"></td>
      <td><input type="checkbox" ${u.vacant ? 'checked' : ''} id="vacant-${i}"></td>
      <td><button class="btn btn-primary btn-sm" onclick="saveUnit(${i})">儲存</button></td>
    </tr>`).join('')}</table>`;
}

window.saveUnit = async function(i) {
  const vacant = document.getElementById(`vacant-${i}`).checked;
  const baseFee = parseInt(document.getElementById(`fee-${i}`).value) || 1500;
  const fee = vacant ? Math.round(baseFee / 2) : baseFee;
  units[i].fee = fee;
  units[i].baseFee = baseFee;
  units[i].vacant = vacant;
  await setDoc(doc(db, 'units', units[i].unit), units[i]);
  document.getElementById(`fee-${i}`).value = fee;
  alert(`${units[i].unit} 設定已儲存！金額：${fee} 元${vacant ? '（空屋減半）' : ''}`);
}

// ========== 啟動 ==========
async function init() {
  document.getElementById('app').innerHTML = '<div style="text-align:center;padding:60px;color:#666">系統載入中...</div>';
  await loadUnits();
  renderApp();
}
init();
