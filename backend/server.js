const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const config = require('./config');
const { initDB, run, getOne, getAll, transaction } = require('./database');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}
app.use('/uploads', express.static(config.UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, '../frontend')));

function getFamilyTotalIncome(familyId) {
  const members = getAll('SELECT income FROM family_members WHERE family_id = ?', familyId);
  return members.reduce((sum, m) => sum + (m.income || 0), 0);
}

function isFamilyInfoComplete(familyId) {
  const family = getOne('SELECT * FROM families WHERE id = ?', familyId);
  if (!family) return false;
  if (!family.head_name || !family.address || !family.income_source) return false;
  const members = getAll('SELECT * FROM family_members WHERE family_id = ?', familyId);
  if (members.length === 0) return false;
  for (const m of members) {
    if (!m.name || !m.relation) return false;
  }
  return true;
}

// ==================== 家庭档案 API ====================

app.get('/api/families', (req, res) => {
  const rows = getAll(`
    SELECT f.*, 
      (SELECT COUNT(*) FROM family_members WHERE family_id = f.id) as member_count
    FROM families f ORDER BY f.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/families/:id', (req, res) => {
  const family = getOne('SELECT * FROM families WHERE id = ?', req.params.id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });
  const members = getAll('SELECT * FROM family_members WHERE family_id = ?', req.params.id);
  family.members = members;
  family.total_income = getFamilyTotalIncome(req.params.id);
  res.json(family);
});

app.post('/api/families', (req, res) => {
  const { family_code, head_name, address, income_source, last_review_conclusion, created_by, members } = req.body;
  if (!family_code || !head_name || !address || !income_source || !created_by) {
    return res.status(400).json({ error: '家庭档案信息不完整' });
  }
  if (!members || members.length === 0) {
    return res.status(400).json({ error: '至少需要一位家庭成员' });
  }

  let newId = null;
  try {
    transaction(() => {
      const info = run(`
        INSERT INTO families (family_code, head_name, address, income_source, subsidy_status, last_review_conclusion, created_by)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `, family_code, head_name, address, income_source, last_review_conclusion || null, created_by);

      for (const m of members) {
        if (!m.name || !m.relation) {
          throw new Error('家庭成员信息不完整');
        }
        run(`
          INSERT INTO family_members (family_id, name, relation, id_card, age, income, employment_status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, info.lastInsertRowid, m.name, m.relation, m.id_card || null, m.age || null, m.income || 0, m.employment_status || null);
      }
      newId = info.lastInsertRowid;
    });
    res.json({ id: newId, message: '家庭档案创建成功' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/families/:id', (req, res) => {
  const { head_name, address, income_source, subsidy_status, last_review_conclusion, members } = req.body;
  try {
    transaction(() => {
      run(`
        UPDATE families SET head_name = ?, address = ?, income_source = ?, subsidy_status = ?, last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, head_name, address, income_source, subsidy_status || 'active', last_review_conclusion || null, req.params.id);

      run('DELETE FROM family_members WHERE family_id = ?', req.params.id);
      for (const m of members) {
        run(`
          INSERT INTO family_members (family_id, name, relation, id_card, age, income, employment_status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, req.params.id, m.name, m.relation, m.id_card || null, m.age || null, m.income || 0, m.employment_status || null);
      }
    });
    res.json({ message: '家庭档案更新成功' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/families/:id', (req, res) => {
  run('DELETE FROM families WHERE id = ?', req.params.id);
  res.json({ message: '删除成功' });
});

// ==================== 走访记录 API ====================

app.get('/api/visits', (req, res) => {
  const rows = getAll(`
    SELECT v.*, f.family_code, f.head_name, f.address
    FROM visits v JOIN families f ON v.family_id = f.id
    ORDER BY v.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/visits/:id', (req, res) => {
  const visit = getOne('SELECT * FROM visits WHERE id = ?', req.params.id);
  if (!visit) return res.status(404).json({ error: '走访记录不存在' });
  const family = getOne('SELECT * FROM families WHERE id = ?', visit.family_id);
  visit.family = family;
  res.json(visit);
});

app.post('/api/visits', upload.single('photo'), (req, res) => {
  const { family_id, visitor_name, visit_date, location, location_lat, location_lng, income_change, notes } = req.body;

  if (!family_id || !visitor_name || !visit_date) {
    return res.status(400).json({ error: '走访人、走访日期和家庭为必填项' });
  }

  if (!req.file) {
    return res.status(400).json({ error: '走访照片为必填项，请上传照片后提交' });
  }

  const family = getOne('SELECT * FROM families WHERE id = ?', family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });

  const visitDate = new Date(visit_date);
  const createdAt = new Date(family.created_at);
  const vd = new Date(visitDate.getFullYear(), visitDate.getMonth(), visitDate.getDate());
  const cd = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  if (vd < cd) {
    return res.status(400).json({ error: '走访日期不能早于建档日期' });
  }

  if (!isFamilyInfoComplete(family_id)) {
    return res.status(400).json({ error: '家庭成员信息不完整，不能提交走访记录' });
  }

  const photo_path = req.file.filename;

  const info = run(`
    INSERT INTO visits (family_id, visitor_name, visit_date, location, location_lat, location_lng, income_change, notes, photo_path, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
  `, family_id, visitor_name, visit_date, location || null, location_lat || null, location_lng || null,
       income_change || 0, notes || null, photo_path);

  res.json({ id: info.lastInsertRowid, message: '走访记录提交成功' });
});

// ==================== 审核 API ====================

app.get('/api/reviews/pending', (req, res) => {
  const rows = getAll(`
    SELECT v.*, f.family_code, f.head_name,
      (SELECT SUM(income) FROM family_members WHERE family_id = f.id) as total_income
    FROM visits v 
    JOIN families f ON v.family_id = f.id
    WHERE v.status = 'submitted'
    ORDER BY v.created_at DESC
  `);
  for (const r of rows) {
    r.threshold = config.INCOME_THRESHOLD;
  }
  res.json(rows);
});

app.get('/api/reviews', (req, res) => {
  const rows = getAll(`
    SELECT r.*, v.visit_date, f.family_code, f.head_name
    FROM reviews r 
    JOIN visits v ON r.visit_id = v.id
    JOIN families f ON v.family_id = f.id
    ORDER BY r.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/reviews', (req, res) => {
  const { visit_id, reviewer_name, decision, reason } = req.body;
  if (!visit_id || !reviewer_name || !decision) {
    return res.status(400).json({ error: '审核信息不完整' });
  }
  if (!['continue', 'suspend', 'cancel'].includes(decision)) {
    return res.status(400).json({ error: '审核决定无效' });
  }

  const visit = getOne('SELECT * FROM visits WHERE id = ?', visit_id);
  if (!visit) return res.status(404).json({ error: '走访记录不存在' });
  if (visit.status !== 'submitted') return res.status(400).json({ error: '该走访记录已审核' });

  const totalIncome = getFamilyTotalIncome(visit.family_id);
  const newIncome = totalIncome + (visit.income_change || 0);

  try {
    transaction(() => {
      run(`
        INSERT INTO reviews (visit_id, reviewer_name, decision, reason, threshold_applied)
        VALUES (?, ?, ?, ?, ?)
      `, visit_id, reviewer_name, decision, reason || null, config.INCOME_THRESHOLD);

      let familyStatus = 'active';
      let conclusion = '';

      if (decision === 'continue') {
        if (newIncome > config.INCOME_THRESHOLD) {
          familyStatus = 'review';
          conclusion = '收入超过阈值，进入复核，本期补贴冻结';
          const period = new Date().toISOString().slice(0, 7);
          const existing = getOne('SELECT * FROM subsidies WHERE family_id = ? AND period = ?', visit.family_id, period);
          if (existing) {
            run('UPDATE subsidies SET status = ?, frozen_reason = ? WHERE id = ?',
              'frozen', '收入超过阈值，复核中', existing.id);
          } else {
            run(`
              INSERT INTO subsidies (family_id, period, amount, status, frozen_reason)
              VALUES (?, ?, ?, 'frozen', '收入超过阈值，复核中')
            `, visit.family_id, period, 0);
          }
        } else {
          conclusion = '符合条件，继续发放';
        }
      } else if (decision === 'suspend') {
        familyStatus = 'suspended';
        conclusion = reason || '暂停发放';
      } else if (decision === 'cancel') {
        familyStatus = 'cancelled';
        conclusion = reason || '取消资格';
      }

      run(`
        UPDATE families SET subsidy_status = ?, last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, familyStatus, conclusion, visit.family_id);

      run('UPDATE visits SET status = ? WHERE id = ?', 'reviewed', visit_id);
    });
    res.json({ message: '审核完成' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ==================== 补贴 API ====================

app.get('/api/subsidies', (req, res) => {
  const rows = getAll(`
    SELECT s.*, f.family_code, f.head_name, f.subsidy_status as family_status
    FROM subsidies s 
    JOIN families f ON s.family_id = f.id
    ORDER BY s.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/subsidies', (req, res) => {
  const { family_id, period, amount } = req.body;
  if (!family_id || !period || amount == null) {
    return res.status(400).json({ error: '补贴信息不完整' });
  }

  const family = getOne('SELECT * FROM families WHERE id = ?', family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });

  if (family.subsidy_status === 'cancelled') {
    return res.status(400).json({ error: '该家庭已取消低保资格，不能生成补贴，须先通过恢复申请' });
  }

  const activeAppeal = getOne(
    "SELECT * FROM appeals WHERE family_id = ? AND status = 'pending'",
    family_id
  );
  if (activeAppeal) {
    return res.status(400).json({ error: '该家庭存在异议申诉中，本期补贴保持冻结，不能被普通审核绕过' });
  }

  const existing = getOne('SELECT * FROM subsidies WHERE family_id = ? AND period = ?', family_id, period);
  if (existing) {
    return res.status(400).json({ error: '该期间补贴已存在' });
  }

  let status = 'pending';
  let frozen_reason = null;

  const totalIncome = getFamilyTotalIncome(family_id);
  if (family.subsidy_status === 'review' || totalIncome > config.INCOME_THRESHOLD) {
    status = 'frozen';
    frozen_reason = family.subsidy_status === 'review' ? '正在复核中' : '收入超过阈值';
  } else if (family.subsidy_status === 'suspended') {
    status = 'suspended';
    frozen_reason = '资格暂停';
  }

  const info = run(`
    INSERT INTO subsidies (family_id, period, amount, status, frozen_reason)
    VALUES (?, ?, ?, ?, ?)
  `, family_id, period, amount, status, frozen_reason);

  res.json({ id: info.lastInsertRowid, message: '补贴记录已生成', status });
});

app.put('/api/subsidies/:id/release', (req, res) => {
  const sub = getOne('SELECT * FROM subsidies WHERE id = ?', req.params.id);
  if (!sub) return res.status(404).json({ error: '补贴记录不存在' });
  if (sub.status !== 'frozen' && sub.status !== 'pending') {
    return res.status(400).json({ error: '当前状态不能发放' });
  }

  const family = getOne('SELECT * FROM families WHERE id = ?', sub.family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });

  if (family.subsidy_status === 'cancelled') {
    return res.status(400).json({ error: '该家庭已取消低保资格，不能发放补贴，须先通过恢复申请' });
  }

  const activeAppeal = getOne(
    "SELECT * FROM appeals WHERE family_id = ? AND status = 'pending'",
    sub.family_id
  );
  if (activeAppeal) {
    return res.status(400).json({ error: '该家庭存在异议申诉中，本期补贴保持冻结，不能被普通审核绕过' });
  }

  run("UPDATE subsidies SET status = 'released' WHERE id = ?", req.params.id);
  res.json({ message: '补贴已发放' });
});

// ==================== 资格恢复 API ====================

app.get('/api/restorations', (req, res) => {
  const rows = getAll(`
    SELECT r.*, f.family_code, f.head_name
    FROM qualification_restorations r 
    JOIN families f ON r.family_id = f.id
    ORDER BY r.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/restorations', (req, res) => {
  const { family_id, applicant_name, reason } = req.body;
  if (!family_id || !applicant_name || !reason) {
    return res.status(400).json({ error: '申请信息不完整' });
  }
  const family = getOne('SELECT * FROM families WHERE id = ?', family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });

  const info = run(`
    INSERT INTO qualification_restorations (family_id, applicant_name, reason, status)
    VALUES (?, ?, ?, 'pending')
  `, family_id, applicant_name, reason);

  res.json({ id: info.lastInsertRowid, message: '资格恢复申请已提交' });
});

app.post('/api/restorations/:id/review', (req, res) => {
  const { reviewer_name, approved, reason } = req.body;
  const record = getOne('SELECT * FROM qualification_restorations WHERE id = ?', req.params.id);
  if (!record) return res.status(404).json({ error: '申请不存在' });

  transaction(() => {
    if (approved) {
      run(`
        UPDATE families SET subsidy_status = 'active', last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, reason || '资格恢复通过', record.family_id);
      run(`
        UPDATE qualification_restorations SET status = 'approved', reviewer_name = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, reviewer_name, reason || null, req.params.id);
    } else {
      run(`
        UPDATE qualification_restorations SET status = 'rejected', reviewer_name = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, reviewer_name, reason || null, req.params.id);
    }
  });
  res.json({ message: '审核完成' });
});

// ==================== 异议申诉 API ====================

app.get('/api/appeals', (req, res) => {
  const rows = getAll(`
    SELECT a.*, f.family_code, f.head_name, f.subsidy_status as family_status
    FROM appeals a 
    JOIN families f ON a.family_id = f.id
    ORDER BY a.created_at DESC
  `);
  for (const a of rows) {
    a.revisits = getAll('SELECT * FROM revisits WHERE appeal_id = ?', a.id);
  }
  res.json(rows);
});

app.get('/api/appeals/:id', (req, res) => {
  const appeal = getOne('SELECT * FROM appeals WHERE id = ?', req.params.id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  const family = getOne('SELECT * FROM families WHERE id = ?', appeal.family_id);
  appeal.family = family;
  appeal.revisits = getAll('SELECT * FROM revisits WHERE appeal_id = ?', appeal.id);
  const recovery = getOne('SELECT * FROM recoveries WHERE appeal_id = ?', appeal.id);
  appeal.recovery = recovery;
  res.json(appeal);
});

app.post('/api/appeals', (req, res) => {
  const { family_id, applicant_name, reason, material_desc } = req.body;
  if (!family_id || !applicant_name || !reason) {
    return res.status(400).json({ error: '申诉信息不完整' });
  }
  const family = getOne('SELECT * FROM families WHERE id = ?', family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });
  if (family.subsidy_status !== 'suspended' && family.subsidy_status !== 'cancelled' && family.subsidy_status !== 'review') {
    return res.status(400).json({ error: '只有暂停、取消或复核中的家庭才能提交异议申诉' });
  }

  try {
    transaction(() => {
      const info = run(`
        INSERT INTO appeals (family_id, applicant_name, reason, material_desc, status)
        VALUES (?, ?, ?, ?, 'pending')
      `, family_id, applicant_name, reason, material_desc || null);

      const period = new Date().toISOString().slice(0, 7);
      const existing = getOne('SELECT * FROM subsidies WHERE family_id = ? AND period = ?', family_id, period);
      if (existing && existing.status !== 'frozen') {
        run('UPDATE subsidies SET status = ?, frozen_reason = ? WHERE id = ?',
          'frozen', '异议申诉中，补贴冻结', existing.id);
      } else if (!existing) {
        run(`
          INSERT INTO subsidies (family_id, period, amount, status, frozen_reason)
          VALUES (?, ?, ?, 'frozen', '异议申诉中，补贴冻结')
        `, family_id, period, 0);
      }

      res.json({ id: info.lastInsertRowid, message: '异议申诉已提交，本期补贴保持冻结' });
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/appeals/:id/review', (req, res) => {
  const { reviewer_name, decision, reason } = req.body;
  if (!reviewer_name || !decision) {
    return res.status(400).json({ error: '审核信息不完整' });
  }
  if (!['restore', 'maintain', 'recover'].includes(decision)) {
    return res.status(400).json({ error: '审核决定无效，须为 restore/maintain/recover' });
  }

  const appeal = getOne('SELECT * FROM appeals WHERE id = ?', req.params.id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(400).json({ error: '该申诉已审核' });

  try {
    transaction(() => {
      run(`
        UPDATE appeals SET status = 'reviewed', reviewer_name = ?, review_decision = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, reviewer_name, decision, reason || null, req.params.id);

      if (decision === 'restore') {
        run(`
          UPDATE families SET subsidy_status = 'active', last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, reason || '异议申诉通过，恢复资格', appeal.family_id);
        const period = new Date().toISOString().slice(0, 7);
        const sub = getOne('SELECT * FROM subsidies WHERE family_id = ? AND period = ?', appeal.family_id, period);
        if (sub && sub.status === 'frozen') {
          run('UPDATE subsidies SET status = ?, frozen_reason = NULL WHERE id = ?', 'pending', sub.id);
        }
      } else if (decision === 'maintain') {
        run(`
          UPDATE families SET last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, reason || '异议申诉驳回，维持原决定', appeal.family_id);
      } else if (decision === 'recover') {
        run(`
          UPDATE families SET last_review_conclusion = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, reason || '异议申诉审核，启动补贴追回', appeal.family_id);
      }
    });
    res.json({ message: '申诉审核完成', decision });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ==================== 复访记录 API ====================

app.post('/api/revisits', upload.single('photo'), (req, res) => {
  const { appeal_id, family_id, visitor_name, visit_date, location, income_change, notes } = req.body;

  if (!appeal_id || !family_id || !visitor_name || !visit_date) {
    return res.status(400).json({ error: '复访信息不完整' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '走访照片为必填项，照片缺失不能提交复访' });
  }

  const appeal = getOne('SELECT * FROM appeals WHERE id = ?', appeal_id);
  if (!appeal) return res.status(404).json({ error: '申诉不存在' });
  if (appeal.status !== 'pending') return res.status(400).json({ error: '申诉已审核，不能再提交复访' });

  if (!isFamilyInfoComplete(family_id)) {
    return res.status(400).json({ error: '家庭成员信息不完整，不能提交复访记录' });
  }

  const photo_path = req.file.filename;
  const info = run(`
    INSERT INTO revisits (appeal_id, family_id, visitor_name, visit_date, location, income_change, notes, photo_path, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
  `, appeal_id, family_id, visitor_name, visit_date, location || null,
       income_change || 0, notes || null, photo_path);

  res.json({ id: info.lastInsertRowid, message: '复访记录提交成功' });
});

app.get('/api/revisits', (req, res) => {
  const { appeal_id } = req.query;
  let sql = `
    SELECT rv.*, f.family_code, f.head_name
    FROM revisits rv 
    JOIN families f ON rv.family_id = f.id
  `;
  const params = [];
  if (appeal_id) {
    sql += ' WHERE rv.appeal_id = ?';
    params.push(appeal_id);
  }
  sql += ' ORDER BY rv.created_at DESC';
  const rows = getAll(sql, ...params);
  res.json(rows);
});

// ==================== 补贴追回 API ====================

app.get('/api/recoveries', (req, res) => {
  const rows = getAll(`
    SELECT rc.*, f.family_code, f.head_name
    FROM recoveries rc 
    JOIN families f ON rc.family_id = f.id
    ORDER BY rc.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/recoveries/calculate', (req, res) => {
  const { family_id, months_issued, monthly_amount, freeze_months, hardship_desc } = req.body;
  if (!family_id || months_issued == null || monthly_amount == null) {
    return res.status(400).json({ error: '追回计算参数不完整' });
  }
  const base = months_issued * monthly_amount;
  const freezeDeduction = (freeze_months || 0) * monthly_amount * 0.5;
  let total = base - freezeDeduction;
  if (hardship_desc && hardship_desc.trim().length > 0) {
    total = total * 0.8;
  }
  if (total < 0) total = 0;
  total = Math.round(total * 100) / 100;
  res.json({
    base_amount: base,
    freeze_deduction: freezeDeduction,
    hardship_reduction: hardship_desc ? base * 0.2 : 0,
    total_amount: total,
    calculation_detail: `已发放${months_issued}月 × ${monthly_amount}元 = ${base}元` +
      (freezeDeduction > 0 ? `，冻结期${freeze_months}月扣减${freezeDeduction}元` : '') +
      (hardship_desc ? `，困难说明扣减20%(${Math.round(base * 0.2 * 100) / 100}元)` : '') +
      `，追回金额：${total}元`
  });
});

app.post('/api/recoveries', (req, res) => {
  const { family_id, appeal_id, months_issued, monthly_amount, freeze_months, hardship_desc, installment_note } = req.body;
  if (!family_id || months_issued == null || monthly_amount == null) {
    return res.status(400).json({ error: '追回信息不完整' });
  }

  const family = getOne('SELECT * FROM families WHERE id = ?', family_id);
  if (!family) return res.status(404).json({ error: '家庭档案不存在' });

  const base = months_issued * monthly_amount;
  const freezeDeduction = (freeze_months || 0) * monthly_amount * 0.5;
  let total = base - freezeDeduction;
  if (hardship_desc && hardship_desc.trim().length > 0) {
    total = total * 0.8;
  }
  if (total < 0) total = 0;
  total = Math.round(total * 100) / 100;

  const info = run(`
    INSERT INTO recoveries (family_id, appeal_id, months_issued, monthly_amount, freeze_months, hardship_desc, total_amount, installment_note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, family_id, appeal_id || null, months_issued, monthly_amount, freeze_months || 0,
       hardship_desc || null, total, installment_note || null);

  res.json({ id: info.lastInsertRowid, total_amount: total, message: '追回记录已生成' });
});

app.post('/api/recoveries/:id/review', (req, res) => {
  const { reviewer_name, approved, reason } = req.body;
  if (!reviewer_name) {
    return res.status(400).json({ error: '审核人不能为空' });
  }
  const recovery = getOne('SELECT * FROM recoveries WHERE id = ?', req.params.id);
  if (!recovery) return res.status(404).json({ error: '追回记录不存在' });
  if (recovery.status !== 'pending') return res.status(400).json({ error: '该追回已审核' });

  const status = approved ? 'approved' : 'rejected';
  run(`
    UPDATE recoveries SET status = ?, reviewer_name = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, status, reviewer_name, reason || null, req.params.id);

  res.json({ message: approved ? '追回已确认' : '追回已驳回' });
});

// ==================== 配置 API ====================

app.get('/api/config', (req, res) => {
  res.json({ income_threshold: config.INCOME_THRESHOLD });
});

async function start() {
  await initDB();
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`低保走访核查系统服务已启动: http://localhost:${config.PORT}`);
  });
  module.exports = { app, server };
}

start();
