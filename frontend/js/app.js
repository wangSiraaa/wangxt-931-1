const API_BASE = '';
let editingFamilyId = null;
let currentReviewVisitId = null;
let threshold = 800;

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadThreshold();
  refreshAll();
  setDefaultOperator();
});

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      switchPage(page);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab === 'pending' ? 'pendingReviews' : 'reviewHistory').classList.add('active');
    });
  });

  document.getElementById('btnAddFamily').addEventListener('click', () => openFamilyModal());
  document.getElementById('btnAddVisit').addEventListener('click', () => openVisitModal());
  document.getElementById('btnAddSubsidy').addEventListener('click', () => openSubsidyModal());
  document.getElementById('btnAddRestoration').addEventListener('click', () => openRestorationModal());
  document.getElementById('btnAddAppeal').addEventListener('click', () => openAppealModal());
  document.getElementById('btnAddRecovery').addEventListener('click', () => openRecoveryModal());
}

function setDefaultOperator() {
  const roleMap = { civil: '民政专员A', grid: '网格员A', reviewer: '审核员A' };
  const role = document.getElementById('roleSelect').value;
  if (!document.getElementById('operatorName').value) {
    document.getElementById('operatorName').value = roleMap[role];
  }
  document.getElementById('roleSelect').addEventListener('change', () => {
    document.getElementById('operatorName').value = roleMap[document.getElementById('roleSelect').value];
  });
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 2800);
}

async function api(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  } catch (e) {
    showToast(e.message, 'error');
    throw e;
  }
}

async function loadThreshold() {
  try {
    const data = await api('/api/config');
    threshold = data.income_threshold;
    document.getElementById('thresholdValue').textContent = threshold;
  } catch (e) {}
}

function refreshAll() {
  loadFamilies();
  loadVisits();
  loadPendingReviews();
  loadReviewHistory();
  loadSubsidies();
  loadRestorations();
  loadAppeals();
  loadRecoveries();
}

// ==================== 家庭档案 ====================

async function loadFamilies() {
  try {
    const families = await api('/api/families');
    const container = document.getElementById('familyList');
    if (families.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>暂无家庭档案</p></div>';
      return;
    }
    container.innerHTML = families.map(f => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${f.head_name}（${f.family_code}）
              <span class="status-tag status-${f.subsidy_status}">${getStatusText(f.subsidy_status)}</span>
            </div>
            <div class="card-subtitle">📍 ${f.address} | 👥 ${f.member_count}人</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm btn-secondary" onclick="viewFamily(${f.id})">查看</button>
            <button class="btn btn-sm btn-secondary" onclick="openFamilyModal(${f.id})">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteFamily(${f.id})">删除</button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">收入来源：</span><span class="value">${f.income_source}</span></div>
          <div class="info-item"><span class="label">上次复核：</span><span class="value">${f.last_review_conclusion || '暂无'}</span></div>
          <div class="info-item"><span class="label">建档人：</span><span class="value">${f.created_by}</span></div>
          <div class="info-item"><span class="label">建档时间：</span><span class="value">${f.created_at}</span></div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function viewFamily(id) {
  try {
    const f = await api('/api/families/' + id);
    alert(`
家庭档案详情
================
编号：${f.family_code}
户主：${f.head_name}
地址：${f.address}
收入来源：${f.income_source}
家庭月收入：${f.total_income} 元（阈值：${threshold}元）
状态：${getStatusText(f.subsidy_status)}
上次复核：${f.last_review_conclusion || '暂无'}
建档人：${f.created_by}
建档时间：${f.created_at}

家庭成员：
${f.members.map(m => `  · ${m.name}（${m.relation}）- ${m.income}元/月 - ${m.employment_status || '无'}${m.age ? ' - ' + m.age + '岁' : ''}`).join('\n')}
    `);
  } catch (e) {}
}

async function openFamilyModal(id) {
  editingFamilyId = id || null;
  document.getElementById('familyModalTitle').textContent = id ? '编辑家庭档案' : '新建家庭档案';
  document.getElementById('familyForm').reset();
  document.getElementById('membersList').innerHTML = '';
  document.getElementById('familyCreatedBy').value = document.getElementById('operatorName').value;

  if (id) {
    try {
      const f = await api('/api/families/' + id);
      const form = document.getElementById('familyForm');
      form.family_code.value = f.family_code;
      form.head_name.value = f.head_name;
      form.address.value = f.address;
      form.income_source.value = f.income_source;
      form.last_review_conclusion.value = f.last_review_conclusion || '';
      form.created_by.value = f.created_by;
      f.members.forEach(m => addMemberRow(m));
    } catch (e) { return; }
  } else {
    addMemberRow({ relation: '户主' });
  }
  document.getElementById('familyModal').classList.add('active');
}

function addMemberRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'member-row';
  row.innerHTML = `
    <input type="text" name="name" placeholder="姓名*" value="${data.name || ''}">
    <input type="text" name="relation" placeholder="关系*" value="${data.relation || ''}">
    <input type="number" name="age" placeholder="年龄" value="${data.age || ''}">
    <input type="number" name="income" placeholder="月收入" value="${data.income || 0}" step="any">
    <input type="text" name="employment_status" placeholder="就业状态" value="${data.employment_status || ''}">
    <button type="button" class="remove-member" onclick="this.parentElement.remove()">×</button>
  `;
  document.getElementById('membersList').appendChild(row);
}

async function saveFamily() {
  const form = document.getElementById('familyForm');
  const memberRows = document.querySelectorAll('#membersList .member-row');
  const members = Array.from(memberRows).map(row => ({
    name: row.querySelector('[name=name]').value,
    relation: row.querySelector('[name=relation]').value,
    age: row.querySelector('[name=age]').value,
    income: row.querySelector('[name=income]').value,
    employment_status: row.querySelector('[name=employment_status]').value
  }));

  const data = {
    family_code: form.family_code.value,
    head_name: form.head_name.value,
    address: form.address.value,
    income_source: form.income_source.value,
    last_review_conclusion: form.last_review_conclusion.value,
    created_by: form.created_by.value,
    members
  };

  try {
    if (editingFamilyId) {
      await api('/api/families/' + editingFamilyId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('家庭档案已更新');
    } else {
      await api('/api/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      showToast('家庭档案创建成功');
    }
    closeModal('familyModal');
    loadFamilies();
  } catch (e) {}
}

async function deleteFamily(id) {
  if (!confirm('确认删除该家庭档案？')) return;
  try {
    await api('/api/families/' + id, { method: 'DELETE' });
    showToast('已删除');
    loadFamilies();
  } catch (e) {}
}

// ==================== 走访记录 ====================

async function loadVisits() {
  try {
    const visits = await api('/api/visits');
    const container = document.getElementById('visitList');
    if (visits.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🚶</div><p>暂无走访记录</p></div>';
      return;
    }
    container.innerHTML = visits.map(v => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${v.head_name}（${v.family_code}）
              <span class="status-tag status-${v.status}">${v.status === 'submitted' ? '待审核' : v.status === 'reviewed' ? '已审核' : v.status}</span>
            </div>
            <div class="card-subtitle">📍 ${v.address}</div>
          </div>
          <div class="card-actions">
            ${v.status === 'submitted' ? '<button class="btn btn-sm btn-primary" onclick="switchPage(\'reviews\'); document.querySelector(\'.nav-btn[data-page=reviews]\').click()">去审核</button>' : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">走访人：</span><span class="value">${v.visitor_name}</span></div>
          <div class="info-item"><span class="label">走访日期：</span><span class="value">${v.visit_date}</span></div>
          <div class="info-item"><span class="label">走访地点：</span><span class="value">${v.location || '未填写'}</span></div>
          <div class="info-item"><span class="label">收入变化：</span><span class="value">${v.income_change > 0 ? '+' : ''}${v.income_change} 元</span></div>
          <div class="info-item" style="grid-column: 1 / -1;"><span class="label">备注：</span><span class="value">${v.notes || '无'}</span></div>
          <div class="info-item" style="grid-column: 1 / -1;">
            <span class="label">走访照片：</span>
            ${v.photo_path ? `<img src="/uploads/${v.photo_path}" class="photo-thumbnail">` : '<span class="status-tag status-cancelled">❌ 未上传</span>'}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openVisitModal() {
  document.getElementById('visitForm').reset();
  document.getElementById('visitAlert').style.display = 'none';
  document.getElementById('visitVisitor').value = document.getElementById('operatorName').value;
  document.querySelector('#visitForm input[name=visit_date]').value = new Date().toISOString().split('T')[0];

  try {
    const families = await api('/api/families');
    const select = document.getElementById('visitFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      families.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]</option>`).join('');
  } catch (e) { return; }

  document.getElementById('visitModal').classList.add('active');
}

async function saveVisit() {
  const form = document.getElementById('visitForm');
  const alertEl = document.getElementById('visitAlert');
  const photoFile = document.getElementById('visitPhoto').files[0];

  if (!photoFile) {
    alertEl.textContent = '❌ 走访照片为必填项，请上传照片后再提交';
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
    return;
  }

  const fd = new FormData();
  fd.append('family_id', form.family_id.value);
  fd.append('visitor_name', form.visitor_name.value);
  fd.append('visit_date', form.visit_date.value);
  fd.append('location', form.location.value || '');
  fd.append('location_lat', form.location_lat.value || '');
  fd.append('location_lng', form.location_lng.value || '');
  fd.append('income_change', form.income_change.value || 0);
  fd.append('notes', form.notes.value || '');
  fd.append('photo', photoFile);

  try {
    await api('/api/visits', { method: 'POST', body: fd });
    showToast('走访记录已提交');
    closeModal('visitModal');
    loadVisits();
    loadPendingReviews();
  } catch (e) {}
}

// ==================== 审核 ====================

async function loadPendingReviews() {
  try {
    const reviews = await api('/api/reviews/pending');
    const container = document.getElementById('pendingReviews');
    if (reviews.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>暂无待审核记录</p></div>';
      return;
    }
    container.innerHTML = reviews.map(v => {
      const overThreshold = v.total_income > threshold;
      return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${v.head_name}（${v.family_code}）
              <span class="status-tag status-submitted">待审核</span>
            </div>
            <div class="card-subtitle">走访日期：${v.visit_date} | 走访人：${v.visitor_name}</div>
          </div>
          <div class="card-actions">
            <button class="btn btn-sm btn-primary" onclick="openReviewModal(${v.id})">审核</button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">家庭月收入：</span><span class="value">${v.total_income} 元</span></div>
          <div class="info-item"><span class="label">收入变化：</span><span class="value">${v.income_change > 0 ? '+' : ''}${v.income_change} 元</span></div>
          <div class="info-item"><span class="label">阈值：</span><span class="value">${threshold} 元</span></div>
          <div class="info-item">
            <span class="label">照片：</span>
            <span class="value">${v.photo_path ? '✅ 已上传' : '❌ 未上传'}</span>
          </div>
          <div class="info-highlight ${overThreshold ? '' : 'threshold-ok'}">
            ${overThreshold ? '⚠️ 收入超过阈值（' + v.total_income + ' > ' + threshold + '），不能直接发放，需进入复核并冻结本期补贴' : '✅ 收入在阈值以内（' + v.total_income + ' ≤ ' + threshold + '），可正常发放'}
          </div>
          ${v.notes ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">走访备注：</span><span class="value">${v.notes}</span></div>` : ''}
        </div>
      </div>
    `}).join('');
  } catch (e) {}
}

async function loadReviewHistory() {
  try {
    const reviews = await api('/api/reviews');
    const container = document.getElementById('reviewHistory');
    if (reviews.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">📝</div><p>暂无审核记录</p></div>';
      return;
    }
    container.innerHTML = reviews.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${r.head_name}（${r.family_code}）
              <span class="status-tag status-${r.decision}">${getDecisionText(r.decision)}</span>
            </div>
            <div class="card-subtitle">审核人：${r.reviewer_name} | ${r.created_at}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">走访日期：</span><span class="value">${r.visit_date}</span></div>
          <div class="info-item"><span class="label">适用阈值：</span><span class="value">${r.threshold_applied} 元</span></div>
          <div class="info-item" style="grid-column:1/-1;"><span class="label">审核说明：</span><span class="value">${r.reason || '无'}</span></div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openReviewModal(visitId) {
  currentReviewVisitId = visitId;
  document.getElementById('reviewForm').reset();
  try {
    const visit = await api('/api/visits/' + visitId);
    const family = await api('/api/families/' + visit.family_id);
    const overThreshold = family.total_income > threshold;
    document.getElementById('reviewFamilyInfo').innerHTML = `
      <h4>家庭信息</h4>
      <div class="info-grid">
        <div><strong>${family.head_name}</strong>（${family.family_code}）</div>
        <div>状态：<span class="status-tag status-${family.subsidy_status}">${getStatusText(family.subsidy_status)}</span></div>
        <div>月收入：${family.total_income} 元</div>
        <div>阈值：${threshold} 元</div>
      </div>
      <div class="info-highlight ${overThreshold ? '' : 'threshold-ok'}">
        ${overThreshold ? '⚠️ 收入超过阈值，选择"继续发放"将自动进入复核并冻结本期补贴' : '✅ 收入正常，可正常发放'}
      </div>
      <div style="margin-top:10px; font-size:13px; color:#666;">
        走访人：${visit.visitor_name} | 日期：${visit.visit_date}
        ${visit.location ? ' | 地点：' + visit.location : ''}
        ${visit.income_change ? ' | 收入变化：' + (visit.income_change > 0 ? '+' : '') + visit.income_change + '元' : ''}
        <br>照片：${visit.photo_path ? '✅ 已上传' : '❌ 未上传'}
        ${visit.notes ? '<br>备注：' + visit.notes : ''}
      </div>
    `;
  } catch (e) { return; }
  document.getElementById('reviewModal').classList.add('active');
}

async function submitReview() {
  const form = document.getElementById('reviewForm');
  if (!form.decision.value) {
    showToast('请选择审核决定', 'error');
    return;
  }
  try {
    await api('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visit_id: currentReviewVisitId,
        reviewer_name: document.getElementById('operatorName').value,
        decision: form.decision.value,
        reason: form.reason.value
      })
    });
    showToast('审核完成');
    closeModal('reviewModal');
    loadPendingReviews();
    loadReviewHistory();
    loadFamilies();
    loadSubsidies();
  } catch (e) {}
}

// ==================== 补贴发放 ====================

async function loadSubsidies() {
  try {
    const subsidies = await api('/api/subsidies');
    const container = document.getElementById('subsidyList');
    if (subsidies.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">💰</div><p>暂无补贴记录</p></div>';
      return;
    }
    container.innerHTML = subsidies.map(s => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${s.head_name}（${s.family_code}）
              <span class="status-tag status-${s.status}">${getSubsidyStatus(s.status)}</span>
            </div>
            <div class="card-subtitle">补贴期间：${s.period}</div>
          </div>
          <div class="card-actions">
            ${(s.status === 'pending' || s.status === 'frozen') ?
              `<button class="btn btn-sm btn-success" onclick="releaseSubsidy(${s.id})">发放</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">补贴金额：</span><span class="value" style="color:#fa8c16; font-size:18px; font-weight:600;">¥ ${s.amount.toFixed(2)}</span></div>
          <div class="info-item"><span class="label">家庭状态：</span><span class="value"><span class="status-tag status-${s.family_status}">${getStatusText(s.family_status)}</span></span></div>
          <div class="info-item"><span class="label">生成时间：</span><span class="value">${s.created_at}</span></div>
          ${s.frozen_reason ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">冻结原因：</span><span class="value" style="color:#ff4d4f;">${s.frozen_reason}</span></div>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openSubsidyModal() {
  document.getElementById('subsidyForm').reset();
  document.getElementById('subsidyAlert').style.display = 'none';
  document.querySelector('#subsidyForm input[name=period]').value = new Date().toISOString().slice(0, 7);

  try {
    const families = await api('/api/families');
    const select = document.getElementById('subsidyFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      families.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]${f.subsidy_status === 'cancelled' ? ' ⚠️已取消' : ''}</option>`).join('');
  } catch (e) { return; }

  document.getElementById('subsidyModal').classList.add('active');
}

async function saveSubsidy() {
  const form = document.getElementById('subsidyForm');
  try {
    const res = await api('/api/subsidies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        period: form.period.value,
        amount: parseFloat(form.amount.value)
      })
    });
    showToast(res.message + (res.status !== 'pending' ? '（状态：' + getSubsidyStatus(res.status) + '）' : ''), res.status === 'frozen' || res.status === 'suspended' ? 'info' : 'success');
    closeModal('subsidyModal');
    loadSubsidies();
  } catch (e) {
    document.getElementById('subsidyAlert').textContent = '❌ ' + e.message;
    document.getElementById('subsidyAlert').style.display = 'block';
    document.getElementById('subsidyAlert').className = 'alert alert-error';
  }
}

async function releaseSubsidy(id) {
  if (!confirm('确认发放该笔补贴？')) return;
  try {
    await api('/api/subsidies/' + id + '/release', { method: 'PUT' });
    showToast('补贴已发放');
    loadSubsidies();
  } catch (e) {}
}

// ==================== 资格恢复 ====================

async function loadRestorations() {
  try {
    const records = await api('/api/restorations');
    const container = document.getElementById('restorationList');
    if (records.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">🔄</div><p>暂无资格恢复申请</p></div>';
      return;
    }
    container.innerHTML = records.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${r.head_name}（${r.family_code}）
              <span class="status-tag status-${r.status}">${r.status === 'pending' ? '待审核' : r.status === 'approved' ? '已通过' : '已拒绝'}</span>
            </div>
            <div class="card-subtitle">申请人：${r.applicant_name} | ${r.created_at}</div>
          </div>
          <div class="card-actions">
            ${r.status === 'pending' ? `
              <button class="btn btn-sm btn-success" onclick="reviewRestoration(${r.id}, true)">通过</button>
              <button class="btn btn-sm btn-danger" onclick="reviewRestoration(${r.id}, false)">拒绝</button>
            ` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item" style="grid-column:1/-1;"><span class="label">申请理由：</span><span class="value">${r.reason}</span></div>
          ${r.reviewer_name ? `<div class="info-item"><span class="label">审核人：</span><span class="value">${r.reviewer_name}</span></div>` : ''}
          ${r.review_reason ? `<div class="info-item"><span class="label">审核说明：</span><span class="value">${r.review_reason}</span></div>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function openRestorationModal() {
  document.getElementById('restorationForm').reset();
  try {
    const families = await api('/api/families');
    const cancelled = families.filter(f => f.subsidy_status === 'cancelled');
    const select = document.getElementById('restorationFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      cancelled.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name}</option>`).join('');
    if (cancelled.length === 0) {
      showToast('当前没有已取消资格的家庭', 'info');
    }
  } catch (e) { return; }
  document.getElementById('restorationModal').classList.add('active');
}

async function saveRestoration() {
  const form = document.getElementById('restorationForm');
  try {
    await api('/api/restorations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        applicant_name: form.applicant_name.value,
        reason: form.reason.value
      })
    });
    showToast('申请已提交');
    closeModal('restorationModal');
    loadRestorations();
  } catch (e) {}
}

async function reviewRestoration(id, approved) {
  const reason = prompt(approved ? '请输入通过说明（可选）：' : '请输入拒绝理由：');
  try {
    await api('/api/restorations/' + id + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: document.getElementById('operatorName').value,
        approved,
        reason: reason || ''
      })
    });
    showToast(approved ? '资格恢复通过' : '已拒绝');
    loadRestorations();
    loadFamilies();
  } catch (e) {}
}

// ==================== 工具函数 ====================

function getStatusText(s) {
  const map = { active: '正常', suspended: '暂停', cancelled: '已取消', review: '复核中' };
  return map[s] || s;
}

function getDecisionText(d) {
  const map = { 'continue': '继续发放', 'suspend': '暂停发放', 'cancel': '取消资格' };
  return map[d] || d;
}

function getSubsidyStatus(s) {
  const map = { pending: '待发放', frozen: '已冻结', released: '已发放', suspended: '已暂停' };
  return map[s] || s;
}

// ==================== Tab 切换（申诉与追回页） ====================

document.addEventListener('DOMContentLoaded', () => {
  const appealPageTabs = document.querySelectorAll('#page-appeals .tab-btn');
  appealPageTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('#page-appeals .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('#page-appeals .tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
    });
  });
});

// ==================== 异议申诉 ====================

let currentAppealId = null;

async function loadAppeals() {
  try {
    const appeals = await api('/api/appeals');
    const container = document.getElementById('appealsList');
    if (appeals.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">⚖️</div><p>暂无异议申诉记录</p></div>';
      return;
    }
    container.innerHTML = appeals.map(a => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${a.head_name}（${a.family_code}）
              <span class="status-tag status-${a.status}">${getAppealStatus(a.status)}</span>
            </div>
            <div class="card-subtitle">申请人：${a.applicant_name} | ${a.created_at}</div>
          </div>
          <div class="card-actions">
            ${a.status === 'pending' ? `
              <button class="btn btn-sm btn-secondary" onclick="openRevisitModalForAppeal(${a.id})">补充复访</button>
              <button class="btn btn-sm btn-primary" onclick="openAppealReviewModal(${a.id})">审核</button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" onclick="viewAppealDetail(${a.id})">详情</button>
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">申诉理由：</span><span class="value">${a.reason}</span></div>
          ${a.material_desc ? `<div class="info-item"><span class="label">异议材料：</span><span class="value">${a.material_desc}</span></div>` : ''}
          <div class="info-item"><span class="label">家庭状态：</span><span class="value"><span class="status-tag status-${a.family_status}">${getStatusText(a.family_status)}</span></span></div>
          ${a.review_decision ? `
            <div class="info-item"><span class="label">审核决定：</span><span class="value">${getAppealDecision(a.review_decision)}</span></div>
            <div class="info-item"><span class="label">审核人：</span><span class="value">${a.reviewer_name || '-'}</span></div>
            ${a.review_reason ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">审核说明：</span><span class="value">${a.review_reason}</span></div>` : ''}
          ` : ''}
          ${a.revisits && a.revisits.length > 0 ? `
            <div class="info-item" style="grid-column:1/-1;">
              <span class="label">复访记录：</span>
              <span class="value">共 ${a.revisits.length} 条</span>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function getAppealStatus(s) {
  const map = { pending: '待审核', reviewed: '已审核' };
  return map[s] || s;
}

function getAppealDecision(d) {
  const map = { restore: '恢复资格', maintain: '维持原决定', recover: '启动追回' };
  return map[d] || d;
}

async function viewAppealDetail(id) {
  try {
    const a = await api('/api/appeals/' + id);
    let detail = `
异议申诉详情
================
编号：${a.id}
家庭：${a.family.head_name}（${a.family.family_code}）
家庭状态：${getStatusText(a.family.subsidy_status)}
申请人：${a.applicant_name}
申诉时间：${a.created_at}
状态：${getAppealStatus(a.status)}
申诉理由：${a.reason}
${a.material_desc ? '异议材料：' + a.material_desc : ''}

${a.revisits && a.revisits.length > 0 ? `复访记录（${a.revisits.length}条）：
${a.revisits.map(r => `  · ${r.visit_date} - ${r.visitor_name}
    备注：${r.notes || '无'}
    收入变化：${r.income_change > 0 ? '+' : ''}${r.income_change}元
    照片：${r.photo_path ? '✅已上传' : '❌未上传'}`).join('\n')}
` : '复访记录：无'}

${a.review_decision ? `审核结果：
  决定：${getAppealDecision(a.review_decision)}
  审核人：${a.reviewer_name}
  时间：${a.reviewed_at || '-'}
  ${a.review_reason ? '说明：' + a.review_reason : ''}
` : '审核结果：未审核'}

${a.recovery ? `追回记录：
  追回金额：${a.recovery.total_amount} 元
  已发放月数：${a.recovery.months_issued} 月
  每月金额：${a.recovery.monthly_amount} 元
  冻结月数：${a.recovery.freeze_months || 0} 月
  ${a.recovery.hardship_desc ? '困难说明：' + a.recovery.hardship_desc : ''}
  ${a.recovery.installment_note ? '分期备注：' + a.recovery.installment_note : ''}
  状态：${a.recovery.status === 'pending' ? '待审核' : a.recovery.status === 'approved' ? '已确认' : '已驳回'}
` : ''}
    `;
    alert(detail);
  } catch (e) {}
}

async function openAppealModal() {
  document.getElementById('appealForm').reset();
  document.getElementById('appealAlert').style.display = 'none';

  try {
    const families = await api('/api/families');
    const eligible = families.filter(f =>
      f.subsidy_status === 'suspended' || f.subsidy_status === 'cancelled' || f.subsidy_status === 'review'
    );
    const select = document.getElementById('appealFamilyId');
    select.innerHTML = '<option value="">请选择家庭</option>' +
      eligible.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]</option>`).join('');
    if (eligible.length === 0) {
      showToast('当前没有可申诉的家庭（需为暂停/取消/复核中状态）', 'info');
    }
  } catch (e) { return; }

  document.getElementById('appealModal').classList.add('active');
}

async function saveAppeal() {
  const form = document.getElementById('appealForm');
  const alertEl = document.getElementById('appealAlert');

  if (!form.family_id.value || !form.applicant_name.value || !form.reason.value) {
    alertEl.textContent = '❌ 请填写必填项';
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
    return;
  }

  try {
    await api('/api/appeals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        applicant_name: form.applicant_name.value,
        reason: form.reason.value,
        material_desc: form.material_desc.value
      })
    });
    showToast('异议申诉已提交，本期补贴保持冻结');
    closeModal('appealModal');
    loadAppeals();
    loadSubsidies();
    loadFamilies();
  } catch (e) {
    alertEl.textContent = '❌ ' + e.message;
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
  }
}

async function openAppealReviewModal(id) {
  currentAppealId = id;
  document.getElementById('appealReviewForm').reset();
  try {
    const appeal = await api('/api/appeals/' + id);
    const family = appeal.family;
    document.getElementById('appealReviewInfo').innerHTML = `
      <h4>申诉信息</h4>
      <div class="info-grid">
        <div><strong>${family.head_name}</strong>（${family.family_code}）</div>
        <div>家庭状态：<span class="status-tag status-${family.subsidy_status}">${getStatusText(family.subsidy_status)}</span></div>
        <div>申请人：${appeal.applicant_name}</div>
        <div>申诉时间：${appeal.created_at}</div>
      </div>
      <div style="margin-top:10px;">
        <strong>申诉理由：</strong>${appeal.reason}
      </div>
      ${appeal.material_desc ? `<div style="margin-top:5px;"><strong>异议材料：</strong>${appeal.material_desc}</div>` : ''}
      ${appeal.revisits && appeal.revisits.length > 0 ? `
        <div style="margin-top:10px;">
          <strong>复访记录：</strong>共 ${appeal.revisits.length} 条
          ${appeal.revisits.map(r => `<div style="margin-left:10px;font-size:13px;color:#666;">
            · ${r.visit_date} - ${r.visitor_name} | 收入变化：${r.income_change > 0 ? '+' : ''}${r.income_change}元
            ${r.notes ? '<br>备注：' + r.notes : ''}
          </div>`).join('')}
        </div>
      ` : ''}
    `;
  } catch (e) { return; }
  document.getElementById('appealReviewModal').classList.add('active');
}

async function submitAppealReview() {
  const form = document.getElementById('appealReviewForm');
  if (!form.decision.value) {
    showToast('请选择审核决定', 'error');
    return;
  }
  try {
    await api('/api/appeals/' + currentAppealId + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: document.getElementById('operatorName').value,
        decision: form.decision.value,
        reason: form.reason.value
      })
    });
    showToast('申诉审核完成');
    closeModal('appealReviewModal');
    loadAppeals();
    loadFamilies();
    loadSubsidies();
    loadRecoveries();
  } catch (e) {}
}

// ==================== 复访记录 ====================

async function openRevisitModalForAppeal(appealId) {
  document.getElementById('revisitForm').reset();
  document.getElementById('revisitAlert').style.display = 'none';
  document.getElementById('revisitVisitor').value = document.getElementById('operatorName').value;
  document.querySelector('#revisitForm input[name=visit_date]').value = new Date().toISOString().split('T')[0];

  try {
    const appeals = await api('/api/appeals');
    const pending = appeals.filter(a => a.status === 'pending');
    const select = document.getElementById('revisitAppealId');
    select.innerHTML = '<option value="">请选择申诉</option>' +
      pending.map(a => `<option value="${a.id}" ${a.id === appealId ? 'selected' : ''}>${a.id}号 - ${a.head_name}（${a.family_code}）</option>`).join('');

    if (appealId) {
      const appeal = pending.find(a => a.id === appealId);
      if (appeal) {
        document.getElementById('revisitFamilyId').value = appeal.family_id || '';
      }
    }
  } catch (e) { return; }

  document.getElementById('revisitModal').classList.add('active');
}

async function openRevisitModal() {
  openRevisitModalForAppeal(null);
}

async function saveRevisit() {
  const form = document.getElementById('revisitForm');
  const alertEl = document.getElementById('revisitAlert');
  const photoFile = document.getElementById('revisitPhoto').files[0];

  if (!photoFile) {
    alertEl.textContent = '❌ 走访照片为必填项，照片缺失不能提交复访';
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
    return;
  }

  if (!form.appeal_id.value) {
    alertEl.textContent = '❌ 请选择关联申诉';
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
    return;
  }

  const appealId = form.appeal_id.value;
  let familyId = null;

  try {
    const appeal = await api('/api/appeals/' + appealId);
    familyId = appeal.family_id;
  } catch (e) {
    alertEl.textContent = '❌ 申诉信息获取失败';
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
    return;
  }

  const fd = new FormData();
  fd.append('appeal_id', appealId);
  fd.append('family_id', familyId);
  fd.append('visitor_name', form.visitor_name.value);
  fd.append('visit_date', form.visit_date.value);
  fd.append('location', form.location.value || '');
  fd.append('income_change', form.income_change.value || 0);
  fd.append('notes', form.notes.value || '');
  fd.append('photo', photoFile);

  try {
    await api('/api/revisits', { method: 'POST', body: fd });
    showToast('复访记录提交成功');
    closeModal('revisitModal');
    loadAppeals();
  } catch (e) {
    alertEl.textContent = '❌ ' + e.message;
    alertEl.style.display = 'block';
    alertEl.className = 'alert alert-error';
  }
}

// ==================== 补贴追回 ====================

async function loadRecoveries() {
  try {
    const recoveries = await api('/api/recoveries');
    const container = document.getElementById('recoveriesList');
    if (recoveries.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">💸</div><p>暂无追回记录</p></div>';
      return;
    }
    container.innerHTML = recoveries.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">
              ${r.head_name}（${r.family_code}）
              <span class="status-tag status-${r.status}">${getRecoveryStatus(r.status)}</span>
            </div>
            <div class="card-subtitle">追回金额：<strong style="color:#fa8c16;">¥ ${r.total_amount.toFixed(2)}</strong></div>
          </div>
          <div class="card-actions">
            ${r.status === 'pending' ? `
              <button class="btn btn-sm btn-success" onclick="reviewRecovery(${r.id}, true)">确认</button>
              <button class="btn btn-sm btn-danger" onclick="reviewRecovery(${r.id}, false)">驳回</button>
            ` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="info-item"><span class="label">已发放月数：</span><span class="value">${r.months_issued} 个月</span></div>
          <div class="info-item"><span class="label">每月补贴：</span><span class="value">${r.monthly_amount} 元</span></div>
          <div class="info-item"><span class="label">冻结月数：</span><span class="value">${r.freeze_months || 0} 个月</span></div>
          ${r.hardship_desc ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">困难说明：</span><span class="value">${r.hardship_desc}</span></div>` : ''}
          ${r.installment_note ? `<div class="info-item" style="grid-column:1/-1;"><span class="label">分期备注：</span><span class="value">${r.installment_note}</span></div>` : ''}
          ${r.reviewer_name ? `
            <div class="info-item"><span class="label">审核人：</span><span class="value">${r.reviewer_name}</span></div>
            ${r.review_reason ? `<div class="info-item"><span class="label">审核说明：</span><span class="value">${r.review_reason}</span></div>` : ''}
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function getRecoveryStatus(s) {
  const map = { pending: '待确认', approved: '已确认', rejected: '已驳回' };
  return map[s] || s;
}

async function openRecoveryModal() {
  document.getElementById('recoveryForm').reset();
  document.getElementById('recoveryCalcResult').style.display = 'none';

  try {
    const families = await api('/api/families');
    const familySelect = document.getElementById('recoveryFamilyId');
    familySelect.innerHTML = '<option value="">请选择家庭</option>' +
      families.map(f => `<option value="${f.id}">${f.family_code} - ${f.head_name} [${getStatusText(f.subsidy_status)}]</option>`).join('');

    const appeals = await api('/api/appeals');
    const appealSelect = document.getElementById('recoveryAppealId');
    appealSelect.innerHTML = '<option value="">（可选）关联申诉</option>' +
      appeals.map(a => `<option value="${a.id}">${a.id}号 - ${a.head_name}（${a.family_code}）</option>`).join('');
  } catch (e) { return; }

  document.getElementById('recoveryModal').classList.add('active');
}

async function calculateRecovery() {
  const form = document.getElementById('recoveryForm');
  const resultEl = document.getElementById('recoveryCalcResult');

  if (!form.family_id.value || !form.months_issued.value || !form.monthly_amount.value) {
    showToast('请先填写家庭、已发放月数和每月补贴金额', 'error');
    return;
  }

  try {
    const res = await api('/api/recoveries/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        months_issued: parseInt(form.months_issued.value),
        monthly_amount: parseFloat(form.monthly_amount.value),
        freeze_months: parseInt(form.freeze_months.value) || 0,
        hardship_desc: form.hardship_desc.value
      })
    });
    resultEl.innerHTML = `
      <h4>🧮 追回金额计算结果</h4>
      <div class="info-grid">
        <div>基础金额：<strong>${res.base_amount.toFixed(2)} 元</strong></div>
        ${res.freeze_deduction > 0 ? `<div>冻结期扣减：<strong style="color:#52c41a;">- ${res.freeze_deduction.toFixed(2)} 元</strong></div>` : ''}
        ${res.hardship_reduction > 0 ? `<div>困难减免：<strong style="color:#52c41a;">- ${res.hardship_reduction.toFixed(2)} 元</strong></div>` : ''}
        <div style="grid-column:1/-1;font-size:18px;font-weight:600;color:#fa8c16;">
          追回金额总计：${res.total_amount.toFixed(2)} 元
        </div>
      </div>
      <div style="margin-top:8px;font-size:13px;color:#666;">${res.calculation_detail}</div>
    `;
    resultEl.style.display = 'block';
    resultEl.className = 'info-panel';
  } catch (e) {}
}

async function saveRecovery() {
  const form = document.getElementById('recoveryForm');
  if (!form.family_id.value || !form.months_issued.value || !form.monthly_amount.value) {
    showToast('请填写必填项', 'error');
    return;
  }

  try {
    const res = await api('/api/recoveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family_id: form.family_id.value,
        appeal_id: form.appeal_id.value || null,
        months_issued: parseInt(form.months_issued.value),
        monthly_amount: parseFloat(form.monthly_amount.value),
        freeze_months: parseInt(form.freeze_months.value) || 0,
        hardship_desc: form.hardship_desc.value,
        installment_note: form.installment_note.value
      })
    });
    showToast('追回记录已生成，金额：' + res.total_amount + ' 元');
    closeModal('recoveryModal');
    loadRecoveries();
  } catch (e) {}
}

async function reviewRecovery(id, approved) {
  const reason = prompt(approved ? '请输入确认说明（可选）：' : '请输入驳回理由：');
  try {
    await api('/api/recoveries/' + id + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: document.getElementById('operatorName').value,
        approved,
        reason: reason || ''
      })
    });
    showToast(approved ? '追回已确认' : '追回已驳回');
    loadRecoveries();
  } catch (e) {}
}
