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
      <button class="tab" onclick="switchTab('manage')">🔧 資料管理</button>
    </div>

    <div id="page-pay" class="page active">${renderPayPage(year, month)}</div>
    <div id="page-finance" class="page">${renderFinancePage(year, month)}</div>
    <div id="page-query" class="page">${renderQueryPage(year)}</div>
    <div id="page-report" class="page">${renderReportPage(year, month)}</div>
    <div id="page-settings" class="page">${renderSettingsPage()}</div>
    <div id="page-manage" class="page">${renderManagePage()}</div>
  `;
  bindPayEvents();
  bindFinanceEvents();
  loadPaySummary(year, month);
  loadFinanceList(year, month);
  loadQuery(year);
  loadSummaryTable(year);
  loadSettingsTable();
}
// ========== 資料管理 ==========
function renderManagePage() {
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">繳費記錄管理</div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <label>搜尋住戶</label>
          <input type="text" id="manage-unit" placeholder="例：1F 或 8F-5" list="unit-list">
          <datalist id="unit-list"></datalist>
        </div>
        <div><label>年份</label><input type="number" id="manage-year" value="115" style="width:80px"></div>
        <div><label>月份（空白=全部）</label><input type="number" id="manage-month" placeholder="全部" style="width:80px" min="1" max="12"></div>
        <div><button class="btn btn-primary" onclick="searchPayments()">搜尋</button></div>
      </div>
      <div id="manage-pay-list" class="overflow-x" style="margin-top:14px"></div>
    </div>
    <div class="card">
      <div class="card-title">收支記錄管理</div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div><label>年份</label><input type="number" id="manage-fin-year" value="115" style="width:80px"></div>
        <div><label>月份（空白=全部）</label><input type="number" id="manage-fin-month" placeholder="全部" style="width:80px" min="1" max="12"></div>
        <div><label>類型</label>
          <select id="manage-fin-type" style="width:120px">
            <option value="">全部</option>
            <option value="收入">收入</option>
            <option value="支出">支出</option>
          </select>
        </div>
        <div><button class="btn btn-primary" onclick="searchFinances()">搜尋</button></div>
      </div>
      <div id="manage-fin-list" class="overflow-x" style="margin-top:14px"></div>
    </div>`;
}

window.searchPayments = async function() {
  const unit = document.getElementById('manage-unit').value.trim();
  const year = parseInt(document.getElementById('manage-year').value);
  const month = parseInt(document.getElementById('manage-month').value) || 0;
  const el = document.getElementById('manage-pay-list');
  el.innerHTML = '<div class="loading">搜尋中...</div>';

  let q;
  if (unit) {
    q = month
      ? query(collection(db, 'payments'), where('unit','==',unit), where('year','==',year), where('month','==',month))
      : query(collection(db, 'payments'), where('unit','==',unit), where('year','==',year));
  } else {
    q = month
      ? query(collection(db, 'payments'), where('year','==',year), where('month','==',month))
      : query(collection(db, 'payments'), where('year','==',year));
  }

  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
  list.sort((a,b) => a.month - b.month || (a.unit > b.unit ? 1 : -1));

  if (!list.length) { el.innerHTML = '<div class="empty">查無記錄</div>'; return; }

  el.innerHTML = `<table>
    <tr><th>住戶</th><th>年</th><th>月</th><th>繳費日期</th><th>收據編號</th><th>金額</th><th>遲交</th><th>備註</th><th>操作</th></tr>
    ${list.map(p => `<tr id="pay-row-${p.id}">
      <td><input value="${p.unit}" style="width:65px;padding:3px 5px" id="pu-${p.id}"></td>
      <td><input type="number" value="${p.year}" style="width:50px;padding:3px 5px" id="py-${p.id}"></td>
      <td><input type="number" value="${p.month}" style="width:40px;padding:3px 5px" id="pm-${p.id}"></td>
      <td><input value="${p.payDate||''}" style="width:75px;padding:3px 5px" id="pd-${p.id}"></td>
      <td><input value="${p.receipt||''}" style="width:75px;padding:3px 5px" id="pr-${p.id}"></td>
      <td><input type="number" value="${p.fee||0}" style="width:70px;padding:3px 5px" id="pf-${p.id}"></td>
      <td><select id="pl-${p.id}" style="width:60px;padding:3px 2px">
        <option value="false" ${!p.late?'selected':''}>否</option>
        <option value="true" ${p.late?'selected':''}>是</option>
      </select></td>
      <td><input value="${p.note||''}" style="width:100px;padding:3px 5px" id="pn-${p.id}"></td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="savePayment('${p.id}')">存</button>
        <button class="btn btn-danger btn-sm" style="margin-left:3px" onclick="delPayment('${p.id}')">刪</button>
      </td>
    </tr>`).join('')}
  </table>`;
}

window.savePayment = async function(id) {
  const data = {
    unit: document.getElementById(`pu-${id}`).value.trim(),
    year: parseInt(document.getElementById(`py-${id}`).value),
    month: parseInt(document.getElementById(`pm-${id}`).value),
    payDate: document.getElementById(`pd-${id}`).value.trim(),
    receipt: document.getElementById(`pr-${id}`).value.trim(),
    fee: parseFloat(document.getElementById(`pf-${id}`).value) || 0,
    late: document.getElementById(`pl-${id}`).value === 'true',
    note: document.getElementById(`pn-${id}`).value.trim(),
  };
  await setDoc(doc(db, 'payments', id), data, { merge: true });
  const row = document.getElementById(`pay-row-${id}`);
  row.style.background = '#e6f4ea';
  setTimeout(() => row.style.background = '', 1500);
}

window.delPayment = async function(id) {
  if (!confirm('確定刪除此筆繳費記錄？')) return;
  await deleteDoc(doc(db, 'payments', id));
  document.getElementById(`pay-row-${id}`).remove();
}

window.searchFinances = async function() {
  const year = parseInt(document.getElementById('manage-fin-year').value);
  const month = parseInt(document.getElementById('manage-fin-month').value) || 0;
  const type = document.getElementById('manage-fin-type').value;
  const el = document.getElementById('manage-fin-list');
  el.innerHTML = '<div class="loading">搜尋中...</div>';

  let q = month
    ? query(collection(db, 'finances'), where('year','==',year), where('month','==',month))
    : query(collection(db, 'finances'), where('year','==',year));

  const snap = await getDocs(q);
  let list = snap.docs.map(d => ({id: d.id, ...d.data()}));
  if (type) list = list.filter(f => f.type === type);
  list.sort((a,b) => a.month - b.month);

  if (!list.length) { el.innerHTML = '<div class="empty">查無記錄</div>'; return; }

  el.innerHTML = `<table>
    <tr><th>月</th><th>日</th><th>類型</th><th>項目</th><th>金額</th><th>收據</th><th>備註</th><th>操作</th></tr>
    ${list.map(f => `<tr id="fin-row-${f.id}">
      <td><input type="number" value="${f.month||''}" style="width:40px;padding:3px 5px" id="fm-${f.id}"></td>
      <td><input value="${f.date||''}" style="width:75px;padding:3px 5px" id="fd-${f.id}"></td>
      <td><select id="ft-${f.id}" style="width:60px;padding:3px 2px">
        <option value="收入" ${f.type==='收入'?'selected':''}>收入</option>
        <option value="支出" ${f.type==='支出'?'selected':''}>支出</option>
      </select></td>
      <td><input value="${f.item||''}" style="width:130px;padding:3px 5px" id="fi-${f.id}"></td>
      <td><input type="number" value="${f.amount||0}" style="width:80px;padding:3px 5px" id="fa-${f.id}"></td>
      <td><input value="${f.receipt||''}" style="width:80px;padding:3px 5px" id="fr-${f.id}"></td>
      <td><input value="${f.note||''}" style="width:100px;padding:3px 5px" id="fn-${f.id}"></td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-sm" onclick="saveFinance('${f.id}')">存</button>
        <button class="btn btn-danger btn-sm" style="margin-left:3px" onclick="delFinanceManage('${f.id}')">刪</button>
      </td>
    </tr>`).join('')}
  </table>`;
}

window.saveFinance = async function(id) {
  const data = {
    month: parseInt(document.getElementById(`fm-${id}`).value),
    date: document.getElementById(`fd-${id}`).value.trim(),
    type: document.getElementById(`ft-${id}`).value,
    item: document.getElementById(`fi-${id}`).value.trim(),
    amount: parseFloat(document.getElementById(`fa-${id}`).value) || 0,
    receipt: document.getElementById(`fr-${id}`).value.trim(),
    note: document.getElementById(`fn-${id}`).value.trim(),
  };
  await setDoc(doc(db, 'finances', id), data, { merge: true });
  const row = document.getElementById(`fin-row-${id}`);
  row.style.background = '#e6f4ea';
  setTimeout(() => row.style.background = '', 1500);
}

window.delFinanceManage = async function(id) {
  if (!confirm('確定刪除此筆記錄？')) return;
  await deleteDoc(doc(db, 'finances', id));
  document.getElementById(`fin-row-${id}`).remove();
}
window.switchTab = function(t) {
  currentTab = t;
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab')[['pay','finance','query','report','settings','manage'].indexOf(t)].classList.add('active');
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

// ========== 登記繳費（新版）==========
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
  const totalFee = fee * months.length;
 
  // 解析繳費月份
  const monthNums = months.map(m => parseInt(m.split('-')[1]));
  const startMonth = Math.min(...monthNums);
  const endMonth = Math.max(...monthNums);
 
  // 解析繳費日期的月份（用來計算收入）
  const dateParts = payDate.split('/');
  const payMonth = dateParts.length >= 2 ? parseInt(dateParts[1]) : startMonth;
  const payYear = dateParts.length >= 1 ? parseInt(dateParts[0]) : 115;
 
  // 判斷是否遲交（繳費日超過應繳月10日）
  const payDay = dateParts.length >= 3 ? parseInt(dateParts[2]) : 1;
  const late = payMonth > startMonth || (payMonth === startMonth && payDay > 10);
 
  const btn = document.getElementById('pay-submit');
  btn.textContent = '登記中...'; btn.disabled = true;
  try {
    await addDoc(collection(db, 'payments'), {
      unit,
      payYear,
      payMonth,       // 繳費時間的月份（計算收入用）
      startMonth,     // 已繳起始月
      endMonth,       // 已繳到幾月
      year: payYear,  // 保留相容性
      month: payMonth,
      payDate,
      receipt,
      fee: totalFee,  // 實際收取金額
      late,
      note,
      ts: new Date().toISOString()
    });
    showMsg('pay-msg', `登記成功！${unit} 已繳${startMonth === endMonth ? startMonth + '月' : startMonth + '-' + endMonth + '月'} 共 ${totalFee.toLocaleString()} 元`, true);
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

// ========== 本月繳費摘要（新版）==========
async function loadPaySummary(year, month) {
  const el = document.getElementById('pay-list');
  const statsEl = document.getElementById('pay-stats');
  if (!el) return;
  // 用 payMonth 來篩選本月收入
  const q = query(collection(db, 'payments'), where('payYear', '==', year), where('payMonth', '==', month));
  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const total = list.reduce((s, p) => s + (p.fee || 0), 0);
  const lateCount = list.filter(p => p.late).length;
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">${year}年${month}月收入</div><div class="stat-val">${total.toLocaleString()}</div></div>
    <div class="stat"><div class="stat-label">遲交筆數</div><div class="stat-val" style="color:${lateCount > 0 ? '#c62828' : '#2e7d32'}">${lateCount}</div></div>`;
  if (!list.length) { el.innerHTML = '<div class="empty">本月尚無繳費記錄</div>'; return; }
  el.innerHTML = `<table><tr><th>住戶</th><th>日期</th><th>收據</th><th>已繳月份</th><th>金額</th><th>狀態</th><th></th></tr>
    ${list.slice().reverse().map(p => `<tr class="${p.late ? 'row-late' : ''}">
      <td>${p.unit}</td><td>${p.payDate}</td><td>${p.receipt}</td>
      <td>${p.startMonth === p.endMonth ? p.startMonth + '月' : p.startMonth + '-' + p.endMonth + '月'}</td>
      <td>${(p.fee||0).toLocaleString()}</td>
      <td><span class="badge ${p.late ? 'badge-late' : 'badge-ok'}">${p.late ? '遲交' : '準時'}</span></td>
      <td><button class="btn btn-danger btn-sm" onclick="deletePayment('${p.id}',${year},${month})">刪</button></td>
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
window.deletePayment = async function(id, year, month) {
  if (!confirm('確定刪除此筆繳費記錄？')) return;
  await deleteDoc(doc(db, 'payments', id));
  loadPaySummary(year, month);
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

// ========== 查詢狀況（新版）==========
async function loadQuery(year) {
  const el = document.getElementById('q-table');
  const statsEl = document.getElementById('q-stats');
  if (!el) return;
  const snap = await getDocs(query(collection(db, 'payments'), where('payYear', '==', year)));
  const allPay = snap.docs.map(d => d.data());
 
  // 建立各戶已繳狀況（用 startMonth~endMonth 判斷）
  const coveredMap = {}; // unit -> Set of covered months
  const lateMap = {};
  units.forEach(u => { coveredMap[u.unit] = new Set(); lateMap[u.unit] = 0; });
 
  allPay.forEach(p => {
    if (!coveredMap[p.unit]) coveredMap[p.unit] = new Set();
    const start = p.startMonth || p.payMonth || p.month;
    const end = p.endMonth || p.payMonth || p.month;
    for (let m = start; m <= end; m++) coveredMap[p.unit].add(m);
    if (p.late) lateMap[p.unit] = (lateMap[p.unit] || 0) + 1;
  });
 
  const paidCount = units.filter(u => coveredMap[u.unit] && coveredMap[u.unit].size > 0).length;
  const lateCount = units.filter(u => lateMap[u.unit] > 0).length;
  const discCount = units.filter(u => lateMap[u.unit] === 0 && coveredMap[u.unit] && coveredMap[u.unit].size > 0).length;
 
  statsEl.innerHTML = `
    <div class="stat"><div class="stat-label">已繳費住戶</div><div class="stat-val">${paidCount}</div></div>
    <div class="stat"><div class="stat-label">有遲交記錄</div><div class="stat-val" style="color:#c62828">${lateCount}</div></div>
    <div class="stat"><div class="stat-label">可享12月優惠</div><div class="stat-val" style="color:#2e7d32">${discCount}</div></div>`;
 
  el.innerHTML = `<table><tr><th>住戶</th><th>已繳月份</th><th>已繳到</th><th>遲交次數</th><th>12月優惠</th></tr>
    ${units.map(u => {
      const covered = Array.from(coveredMap[u.unit] || new Set()).sort((a,b) => a-b);
      const maxMonth = covered.length ? Math.max(...covered) : 0;
      const late = lateMap[u.unit] || 0;
      return `<tr class="${late > 0 ? 'row-late' : ''}">
        <td>${u.unit}</td>
        <td style="font-size:12px">${covered.length ? covered.map(m => m + '月').join('、') : '—'}</td>
        <td style="font-weight:500;color:#1a56a0">${maxMonth ? maxMonth + '月' : '—'}</td>
        <td>${late > 0 ? `<span class="badge badge-late">${late}次</span>` : '0'}</td>
        <td><span class="badge ${late === 0 && covered.length > 0 ? 'badge-ok' : late > 0 ? 'badge-late' : 'badge-unpaid'}">
          ${late === 0 && covered.length > 0 ? '享有優惠' : late > 0 ? '無優惠' : '未繳費'}</span></td>
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
          <div><label>年份（民國）</label><input type="number" id="rpt-year" value="${year}" onchange="autoFillPrevBalance()"></div>
          <div><label>月份</label><input type="number" id="rpt-month" value="${month}" min="1" max="12" onchange="autoFillPrevBalance()"></div>
        </div>
        <label>上月結餘（元）</label>
        <input type="number" id="rpt-prev" placeholder="自動帶入或手動輸入">
        <p style="font-size:12px;color:#888;margin-top:4px">若有上月報表記錄會自動帶入</p>
        <button class="btn btn-primary btn-full" id="rpt-submit">產生報表 (PDF列印)</button>
        <div id="rpt-msg"></div>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee">
          <div class="card-title" style="font-size:13px">設定期初結餘</div>
          <label>115年1月期初結餘（元）</label>
          <input type="number" id="init-balance" placeholder="623893">
          <button class="btn btn-full" style="margin-top:8px" onclick="saveInitBalance()">儲存期初結餘</button>
          <div id="init-msg"></div>
        </div>
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

// ========== 月結算（新版）==========
async function loadSummaryTable(year) {
  const el = document.getElementById('summary-table');
  if (!el) return;
  const initSnap = await getDoc(doc(db, 'settings', 'initBalance'));
  let balance = initSnap.exists() ? initSnap.data().value : 0;
  const paySnap = await getDocs(query(collection(db, 'payments'), where('payYear', '==', year)));
  const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', year)));
  const pays = paySnap.docs.map(d => d.data());
  const fins = finSnap.docs.map(d => d.data());
  let html = '<table><tr><th>月份</th><th>管理費收入</th><th>其他收入</th><th>支出</th><th>結餘</th></tr>';
  let hasData = false;
  for (let m = 1; m <= 12; m++) {
    const mgmt = pays.filter(p => p.payMonth === m).reduce((s, p) => s + (p.fee || 0), 0);
    const other = fins.filter(f => f.month === m && f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.month === m && f.type === '支出').reduce((s, f) => s + f.amount, 0);
    if (mgmt || other || exp) {
      balance += mgmt + other - exp;
      hasData = true;
      html += `<tr><td>${year}年${m}月</td><td>${mgmt.toLocaleString()}</td><td>${other.toLocaleString()}</td><td>${exp.toLocaleString()}</td><td style="font-weight:500;color:#1a56a0">${Math.round(balance).toLocaleString()}</td></tr>`;
    }
  }
  html += '</table>';
  el.innerHTML = hasData ? html : '<div class="empty">尚無資料</div>';
}
 
// ========== 產生報表（新版）==========
async function generateReport() {
  const year = parseInt(document.getElementById('rpt-year').value);
  const month = parseInt(document.getElementById('rpt-month').value);
  const prev = parseFloat(document.getElementById('rpt-prev').value) || 0;
  if (!year || !month) return showMsg('rpt-msg', '請填入年份和月份', false);
  const btn = document.getElementById('rpt-submit');
  btn.textContent = '產生中...'; btn.disabled = true;
  try {
    // 收入：用 payMonth 篩選本月實際收款
    const paySnap = await getDocs(query(collection(db, 'payments'), where('payYear', '==', year)));
    const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', year), where('month', '==', month)));
    const allPays = paySnap.docs.map(d => d.data());
    const fins = finSnap.docs.map(d => d.data());
 
    // 本月實際收款（payMonth === month）
    const thisMonthPays = allPays.filter(p => p.payMonth === month);
    const mgmt = thisMonthPays.reduce((s, p) => s + (p.fee || 0), 0);
    const otherInc = fins.filter(f => f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.type === '支出').reduce((s, f) => s + f.amount, 0);
    const totalInc = mgmt + otherInc;
    const net = totalInc - exp;
    const bal = prev + net;
 
    // 報表顯示：找每個住戶在本月的顯示資料
    // 優先顯示本月有繳費的，其次顯示預繳涵蓋本月的
    const displayMap = {};
    allPays.forEach(p => {
      const start = p.startMonth || p.payMonth || p.month;
      const end = p.endMonth || p.payMonth || p.month;
      if (start <= month && end >= month) {
        // 這筆涵蓋本月
        const isPayMonth = p.payMonth === month;
        if (!displayMap[p.unit] || isPayMonth) {
          const periodStr = start === end ? `${year}年${start}月` : `${year}年${start}-${end}月`;
          displayMap[p.unit] = {
            payDate: p.payDate,
            receipt: p.receipt,
            period: isPayMonth ? periodStr : `已繳至${end}月`,
            fee: isPayMonth ? p.fee : '-',
            late: p.late,
          };
        }
      }
    });
 
    // 分三欄
    const perCol = Math.ceil(units.length / 3);
    const col1 = units.slice(0, perCol);
    const col2 = units.slice(perCol, perCol * 2);
    const col3 = units.slice(perCol * 2);
    const maxRows = Math.max(col1.length, col2.length, col3.length);
 
    let unitRows = '';
    for (let i = 0; i < maxRows; i++) {
      const renderCell = (u) => {
        if (!u) return '<td></td><td></td><td></td><td></td><td></td>';
        const p = displayMap[u.unit];
        const isLate = p && p.late;
        const s = isLate ? ' style="background:#d9d9d9"' : '';
        if (!p) return `<td${s}>${u.unit}</td><td${s}></td><td${s}></td><td${s}></td><td${s}></td>`;
        const feeStr = p.fee === '-' ? '-' : (typeof p.fee === 'number' ? p.fee.toLocaleString() : p.fee);
        return `<td${s}>${u.unit}</td><td${s}>${p.payDate||''}</td><td${s}>${p.receipt||''}</td><td${s}>${p.period||''}</td><td${s} style="text-align:right${isLate?';background:#d9d9d9':''}">${feeStr}</td>`;
      };
      unitRows += `<tr>${renderCell(col1[i])}${renderCell(col2[i])}${renderCell(col3[i])}</tr>\n`;
    }
 
    // 支出
    const expItems = fins.filter(f => f.type === '支出');
    const expMid = Math.ceil(expItems.length / 2);
    const exp1 = expItems.slice(0, expMid);
    const exp2 = expItems.slice(expMid);
    const expMaxRows = Math.max(exp1.length, exp2.length, 1);
    let expRows = '';
    for (let i = 0; i < expMaxRows; i++) {
      expRows += `<tr>
        <td>${exp1[i] ? exp1[i].date : ''}</td>
        <td colspan="3">${exp1[i] ? exp1[i].item + (exp1[i].receipt ? `（${exp1[i].receipt}）` : '') : ''}</td>
        <td class="num">${exp1[i] ? exp1[i].amount.toLocaleString() : ''}</td>
        <td>${exp2[i] ? exp2[i].date : ''}</td>
        <td colspan="3">${exp2[i] ? exp2[i].item + (exp2[i].receipt ? `（${exp2[i].receipt}）` : '') : ''}</td>
        <td class="num">${exp2[i] ? exp2[i].amount.toLocaleString() : ''}</td>
      </tr>`;
    }
 
    const otherItems = fins.filter(f => f.type === '收入');
    const otherDetail = otherItems.map((f,i) => `${i+1}. ${f.item} ${f.amount.toLocaleString()}（${f.receipt||''}）`).join('　');
    const lastDay = new Date(year + 1911, month, 0).getDate();
 
    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${year}年${month}月 泰慶天廈收支明細</title>
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif; font-size: 9pt; color: #000; }
  h2 { text-align: center; font-size: 11pt; font-weight: bold; margin-bottom: 6px; }
  .section-title { font-weight: bold; font-size: 9.5pt; margin: 6px 0 3px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #888; padding: 2px 4px; font-size: 8.5pt; }
  th { background: #dce6f1; font-weight: bold; text-align: center; }
  .num { text-align: right; }
  .summary-row td { font-weight: bold; background: #f2f2f2; }
  .sign-row { margin-top: 14px; display: flex; gap: 60px; }
  .sign-row span { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; font-size: 10pt; }
  .note { font-size: 8pt; color: #555; margin-top: 6px; }
  .info-row { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; }
</style>
</head>
<body>
<h2>${year}年${month}月1日至${year}年${month}月${lastDay}日　泰慶天廈收支明細</h2>
<div class="info-row">
  <span class="section-title">(1) 收　入</span>
  <span><strong>A、上個月餘額：${prev.toLocaleString()}</strong></span>
</div>
<table>
  <tr>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
  </tr>
  ${unitRows}
  <tr class="summary-row">
    <td colspan="10"></td>
    <td colspan="3"><strong>B、管理費收入：</strong></td>
    <td colspan="2" class="num"><strong>${mgmt.toLocaleString()}</strong></td>
  </tr>
  <tr>
    <td colspan="5" rowspan="2" style="font-size:8pt;vertical-align:top">
      <div><strong>收入原因：</strong></div>
      <div>${otherDetail || '無'}</div>
    </td>
    <td colspan="3"><strong>其他收入：</strong></td>
    <td colspan="2" class="num">${otherInc.toLocaleString()}</td>
    <td colspan="5"></td>
  </tr>
  <tr>
    <td colspan="3"><strong>D、收入合計(B+C)：</strong></td>
    <td colspan="2" class="num"><strong>${totalInc.toLocaleString()}</strong></td>
    <td colspan="5"></td>
  </tr>
</table>
<div class="section-title" style="margin-top:8px">(2) 支　出</div>
<table>
  <tr>
    <th>日期</th><th colspan="3">支出明細（一）</th><th>金額</th>
    <th>日期</th><th colspan="3">支出明細（二）</th><th>金額</th>
  </tr>
  ${expRows}
  <tr class="summary-row">
    <td><strong>合計：</strong></td><td colspan="3"></td>
    <td class="num"><strong>${exp1.reduce((s,f)=>s+f.amount,0).toLocaleString()}</strong></td>
    <td><strong>合計：</strong></td><td colspan="3"></td>
    <td class="num"><strong>${exp2.reduce((s,f)=>s+f.amount,0).toLocaleString()}</strong></td>
  </tr>
  <tr class="summary-row">
    <td colspan="3"><strong>E、支出合計：</strong></td>
    <td colspan="2" class="num"><strong>${exp.toLocaleString()}</strong></td>
    <td colspan="3"><strong>本期結餘(A+F)：</strong></td>
    <td colspan="2" class="num" style="font-size:11pt;color:#1a56a0"><strong>${bal.toLocaleString()}</strong></td>
  </tr>
  <tr>
    <td colspan="3"><strong>F、差異(D-E)：</strong></td>
    <td colspan="2" class="num">${net.toLocaleString()}</td>
    <td colspan="5"></td>
  </tr>
</table>
<p class="note">※ 灰色底為遲交管理費住戶，無12月份優惠。</p>
<div class="sign-row">
  <span>主委：</span><span>財務：</span><span>製表人：</span>
</div>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;
 
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    showMsg('rpt-msg', `報表已開啟！本期結餘：${bal.toLocaleString()} 元`, true);
    loadSummaryTable(year);
  } catch (e) {
    showMsg('rpt-msg', '錯誤：' + e.message, false);
  }
  btn.textContent = '產生報表 (PDF列印)'; btn.disabled = false;
}
 
function getLastDay(rocYear, month) {
  return new Date(rocYear + 1911, month, 0).getDate();
}
 
window.autoFillPrevBalance = async function() {
  const year = parseInt(document.getElementById('rpt-year').value);
  const month = parseInt(document.getElementById('rpt-month').value);
  if (!year || !month) return;
  const prevBalance = await calcBalanceUpTo(year, month - 1);
  if (prevBalance !== null) {
    document.getElementById('rpt-prev').value = prevBalance;
  }
}
 
async function calcBalanceUpTo(year, month) {
  try {
    const initSnap = await getDoc(doc(db, 'settings', 'initBalance'));
    if (!initSnap.exists()) return null;
    let balance = initSnap.data().value;
    const startYear = initSnap.data().year;
    const startMonth = initSnap.data().month;
    const paySnap = await getDocs(query(collection(db, 'payments'), where('payYear', '==', year)));
    const pays = paySnap.docs.map(d => d.data());
    for (let y = startYear; y <= year; y++) {
      const fromMonth = (y === startYear) ? startMonth : 1;
      const toMonth = (y === year) ? month : 12;
      for (let m = fromMonth; m <= toMonth; m++) {
        const mgmt = pays.filter(p => p.payYear === y && p.payMonth === m).reduce((s, p) => s + (p.fee || 0), 0);
        const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', y), where('month', '==', m)));
        const fins = finSnap.docs.map(d => d.data());
        const otherInc = fins.filter(f => f.type === '收入').reduce((s, f) => s + f.amount, 0);
        const exp = fins.filter(f => f.type === '支出').reduce((s, f) => s + f.amount, 0);
        balance += mgmt + otherInc - exp;
      }
    }
    return Math.round(balance);
  } catch(e) { return null; }
}
 
window.saveInitBalance = async function() {
  const val = parseFloat(document.getElementById('init-balance').value);
  if (!val) return;
  await setDoc(doc(db, 'settings', 'initBalance'), { value: val, year: 115, month: 1 });
  showMsg('init-msg', `期初結餘 ${val.toLocaleString()} 元已儲存！`, true);
  autoFillPrevBalance();
}

    // 只計算本月實際收取的管理費（fee不為'-'且不為0）
    const mgmt = allPays
      .filter(p => p.month === month && p.fee > 0)
      .reduce((s, p) => s + p.fee, 0);
    const otherInc = fins.filter(f => f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.type === '支出').reduce((s, f) => s + f.amount, 0);
    const totalInc = mgmt + otherInc;
    const net = totalInc - exp;
    const bal = prev + net;

    // 分三欄住戶
    const perCol = Math.ceil(units.length / 3);
    const col1 = units.slice(0, perCol);
    const col2 = units.slice(perCol, perCol * 2);
    const col3 = units.slice(perCol * 2);
    const maxRows = Math.max(col1.length, col2.length, col3.length);

    let unitRows = '';
    for (let i = 0; i < maxRows; i++) {
      const renderCell = (u) => {
        if (!u) return '<td></td><td></td><td></td><td></td><td></td>';
        const p = payMap[u.unit];
        const isLate = p && p.late;
        const s = isLate ? ' style="background:#d9d9d9"' : '';
        if (!p) return `<td${s}>${u.unit}</td><td${s}></td><td${s}></td><td${s}></td><td${s}></td>`;
        const feeDisplay = p.fee === '-' ? '-' : (typeof p.fee === 'number' ? p.fee.toLocaleString() : p.fee);
        return `<td${s}>${u.unit}</td><td${s}>${p.payDate||''}</td><td${s}>${p.receipt||''}</td><td${s}>${p.period||''}</td><td${s} style="text-align:right${isLate?';background:#d9d9d9':''}">${feeDisplay}</td>`;
      };
      unitRows += `<tr>${renderCell(col1[i])}${renderCell(col2[i])}${renderCell(col3[i])}</tr>\n`;
    }

    // 支出項目
    const expItems = fins.filter(f => f.type === '支出');
    const expMid = Math.ceil(expItems.length / 2);
    const exp1 = expItems.slice(0, expMid);
    const exp2 = expItems.slice(expMid);
    const expMaxRows = Math.max(exp1.length, exp2.length, 1);
    let expRows = '';
    for (let i = 0; i < expMaxRows; i++) {
      expRows += `<tr>
        <td>${exp1[i] ? exp1[i].date : ''}</td>
        <td colspan="3">${exp1[i] ? exp1[i].item + (exp1[i].receipt ? `（${exp1[i].receipt}）` : '') : ''}</td>
        <td class="num">${exp1[i] ? exp1[i].amount.toLocaleString() : ''}</td>
        <td>${exp2[i] ? exp2[i].date : ''}</td>
        <td colspan="3">${exp2[i] ? exp2[i].item + (exp2[i].receipt ? `（${exp2[i].receipt}）` : '') : ''}</td>
        <td class="num">${exp2[i] ? exp2[i].amount.toLocaleString() : ''}</td>
      </tr>`;
    }

    const otherItems = fins.filter(f => f.type === '收入');
    const otherDetail = otherItems.map((f,i) => `${i+1}. ${f.item} ${f.amount.toLocaleString()}（${f.receipt||''}）`).join('　');
    const lastDay = new Date(year + 1911, month, 0).getDate();

    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>${year}年${month}月 泰慶天廈收支明細</title>
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif; font-size: 9pt; color: #000; }
  h2 { text-align: center; font-size: 11pt; font-weight: bold; margin-bottom: 6px; }
  .section-title { font-weight: bold; font-size: 9.5pt; margin: 6px 0 3px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #888; padding: 2px 4px; font-size: 8.5pt; }
  th { background: #dce6f1; font-weight: bold; text-align: center; }
  .num { text-align: right; }
  .bold { font-weight: bold; }
  .summary-row td { font-weight: bold; background: #f2f2f2; }
  .sign-row { margin-top: 14px; display: flex; gap: 60px; }
  .sign-row span { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2px; font-size: 10pt; }
  .note { font-size: 8pt; color: #555; margin-top: 6px; }
  .info-row { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; }
</style>
</head>
<body>
<h2>${year}年${month}月1日至${year}年${month}月${lastDay}日　泰慶天廈收支明細</h2>

<div class="info-row">
  <span class="section-title">(1) 收　入</span>
  <span><strong>A、上個月餘額：${prev.toLocaleString()}</strong></span>
</div>

<table>
  <tr>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
    <th>住戶</th><th>繳交日期</th><th>收據單號</th><th>收費明細(管理費)</th><th>金額</th>
  </tr>
  ${unitRows}
  <tr class="summary-row">
    <td colspan="10"></td>
    <td colspan="3"><strong>B、管理費收入：</strong></td>
    <td colspan="2" class="num"><strong>${mgmt.toLocaleString()}</strong></td>
  </tr>
  <tr>
    <td colspan="5" rowspan="2" style="font-size:8pt;vertical-align:top">
      <div><strong>收入原因：</strong></div>
      <div>${otherDetail || '無'}</div>
    </td>
    <td colspan="3"><strong>其他收入：</strong></td>
    <td colspan="2" class="num">${otherInc.toLocaleString()}</td>
    <td colspan="5"></td>
  </tr>
  <tr>
    <td colspan="3"><strong>D、收入合計(B+C)：</strong></td>
    <td colspan="2" class="num"><strong>${totalInc.toLocaleString()}</strong></td>
    <td colspan="5"></td>
  </tr>
</table>

<div class="section-title" style="margin-top:8px">(2) 支　出</div>
<table>
  <tr>
    <th>日期</th><th colspan="3">支出明細（一）</th><th>金額</th>
    <th>日期</th><th colspan="3">支出明細（二）</th><th>金額</th>
  </tr>
  ${expRows}
  <tr class="summary-row">
    <td><strong>合計：</strong></td><td colspan="3"></td>
    <td class="num"><strong>${exp1.reduce((s,f)=>s+f.amount,0).toLocaleString()}</strong></td>
    <td><strong>合計：</strong></td><td colspan="3"></td>
    <td class="num"><strong>${exp2.reduce((s,f)=>s+f.amount,0).toLocaleString()}</strong></td>
  </tr>
  <tr class="summary-row">
    <td colspan="3"><strong>E、支出合計：</strong></td>
    <td colspan="2" class="num"><strong>${exp.toLocaleString()}</strong></td>
    <td colspan="3"><strong>本期結餘(A+F)：</strong></td>
    <td colspan="2" class="num" style="font-size:11pt;color:#1a56a0"><strong>${bal.toLocaleString()}</strong></td>
  </tr>
  <tr>
    <td colspan="3"><strong>F、差異(D-E)：</strong></td>
    <td colspan="2" class="num">${net.toLocaleString()}</td>
    <td colspan="5"></td>
  </tr>
</table>

<p class="note">※ 灰色底為遲交管理費住戶，無12月份優惠。</p>

<div class="sign-row">
  <span>主委：</span>
  <span>財務：</span>
  <span>製表人：</span>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    showMsg('rpt-msg', `報表已開啟！本期結餘：${bal.toLocaleString()} 元`, true);
    loadSummaryTable(year);
  } catch (e) {
    showMsg('rpt-msg', '錯誤：' + e.message, false);
  }
  btn.textContent = '產生報表 (PDF列印)'; btn.disabled = false;
}

// ========== 月結算（新版）==========
async function loadSummaryTable(year) {
  const el = document.getElementById('summary-table');
  if (!el) return;
  const initSnap = await getDoc(doc(db, 'settings', 'initBalance'));
  let balance = initSnap.exists() ? initSnap.data().value : 0;
  const paySnap = await getDocs(query(collection(db, 'payments'), where('payYear', '==', year)));
  const finSnap = await getDocs(query(collection(db, 'finances'), where('year', '==', year)));
  const pays = paySnap.docs.map(d => d.data());
  const fins = finSnap.docs.map(d => d.data());
  let html = '<table><tr><th>月份</th><th>管理費收入</th><th>其他收入</th><th>支出</th><th>結餘</th></tr>';
  let hasData = false;
  for (let m = 1; m <= 12; m++) {
    const mgmt = pays.filter(p => p.payMonth === m).reduce((s, p) => s + (p.fee || 0), 0);
    const other = fins.filter(f => f.month === m && f.type === '收入').reduce((s, f) => s + f.amount, 0);
    const exp = fins.filter(f => f.month === m && f.type === '支出').reduce((s, f) => s + f.amount, 0);
    if (mgmt || other || exp) {
      balance += mgmt + other - exp;
      hasData = true;
      html += `<tr><td>${year}年${m}月</td><td>${mgmt.toLocaleString()}</td><td>${other.toLocaleString()}</td><td>${exp.toLocaleString()}</td><td style="font-weight:500;color:#1a56a0">${Math.round(balance).toLocaleString()}</td></tr>`;
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
