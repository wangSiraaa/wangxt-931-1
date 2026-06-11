const initSqlJs = require('sql.js');
const path = require('path');
const config = require('./config');
const fs = require('fs');

let db = null;

const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.DB_PATH, buffer);
  }
}

async function getDB() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(config.DB_PATH)) {
    const fileBuffer = fs.readFileSync(config.DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function toArray(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return Array.from(args);
}

let inTransaction = false;

function run(sql, ...params) {
  const p = toArray(params);
  db.run(sql, p);
  const idResult = db.exec('SELECT last_insert_rowid() as id');
  const chResult = db.exec('SELECT changes() as c');
  if (!inTransaction) saveDB();
  return {
    lastInsertRowid: idResult && idResult[0] && idResult[0].values ? idResult[0].values[0][0] : null,
    changes: chResult && chResult[0] && chResult[0].values ? chResult[0].values[0][0] : 0
  };
}

function getOne(sql, ...params) {
  const p = toArray(params);
  const stmt = db.prepare(sql);
  try {
    if (p.length > 0) stmt.bind(p);
    if (stmt.step()) return stmt.getAsObject();
    return undefined;
  } finally {
    stmt.free();
  }
}

function getAll(sql, ...params) {
  const p = toArray(params);
  const stmt = db.prepare(sql);
  const result = [];
  try {
    if (p.length > 0) stmt.bind(p);
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally {
    stmt.free();
  }
}

function exec(sql) {
  db.exec(sql);
  if (!inTransaction) saveDB();
}

function transaction(fn) {
  inTransaction = true;
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
    saveDB();
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch(_) {}
    saveDB();
    throw e;
  } finally {
    inTransaction = false;
  }
}

async function initDB() {
  await getDB();

  exec(`
    CREATE TABLE IF NOT EXISTS families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_code TEXT UNIQUE NOT NULL,
      head_name TEXT NOT NULL,
      address TEXT NOT NULL,
      income_source TEXT NOT NULL,
      subsidy_status TEXT DEFAULT 'active',
      last_review_conclusion TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS family_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      relation TEXT NOT NULL,
      id_card TEXT,
      age INTEGER,
      income REAL DEFAULT 0,
      employment_status TEXT,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      visitor_name TEXT NOT NULL,
      visit_date DATETIME NOT NULL,
      location TEXT,
      location_lat REAL,
      location_lng REAL,
      income_change REAL DEFAULT 0,
      notes TEXT,
      photo_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER NOT NULL,
      reviewer_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      threshold_applied REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (visit_id) REFERENCES visits(id)
    );

    CREATE TABLE IF NOT EXISTS subsidies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      frozen_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families(id)
    );

    CREATE TABLE IF NOT EXISTS qualification_restorations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      applicant_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewer_name TEXT,
      review_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (family_id) REFERENCES families(id)
    );
  `);

  const cnt = getOne('SELECT COUNT(*) as cnt FROM families').cnt;
  if (cnt === 0) {
    transaction(() => {
      const seedFamily = (code, head, addr, src, status, conclusion, creator) =>
        run(`INSERT INTO families (family_code, head_name, address, income_source, subsidy_status, last_review_conclusion, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, code, head, addr, src, status, conclusion, creator);

      const seedMember = (fid, name, rel, idc, age, inc, emp) =>
        run(`INSERT INTO family_members (family_id, name, relation, id_card, age, income, employment_status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, fid, name, rel, idc, age, inc, emp);

      const fam1 = seedFamily('F001', '张三', '幸福社区1号楼101', '打零工', 'active', '符合条件，继续发放', '民政专员A').lastInsertRowid;
      seedMember(fam1, '张三', '户主', '110101199001011234', 35, 500, '灵活就业');
      seedMember(fam1, '李四', '配偶', '110101199203042345', 33, 300, '待业');
      seedMember(fam1, '张小明', '子女', null, 8, 0, '学生');

      const fam2 = seedFamily('F002', '王五', '和谐社区2号楼202', '无', 'active', '符合条件，继续发放', '民政专员A').lastInsertRowid;
      seedMember(fam2, '王五', '户主', '110101198005053456', 45, 200, '残疾');
      seedMember(fam2, '王小丫', '子女', null, 12, 0, '学生');

      const fam3 = seedFamily('F003', '赵六', '阳光社区3号楼303', '工资收入', 'cancelled', '收入超标，取消资格', '民政专员B').lastInsertRowid;
      seedMember(fam3, '赵六', '户主', '110101197507074567', 50, 3000, '在职');
      seedMember(fam3, '钱七', '配偶', '110101197809085678', 48, 2000, '在职');
    });
  }

  console.log('数据库初始化完成');
}

module.exports = { getDB, initDB, exec, run, getOne, getAll, transaction, saveDB };
