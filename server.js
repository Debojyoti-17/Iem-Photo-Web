import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import Database from 'better-sqlite3';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'iem_photography.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('student','organizer')) DEFAULT 'student',
 college TEXT DEFAULT 'IEM/UEM',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS competitions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 theme TEXT NOT NULL,
 description TEXT DEFAULT '',
 starts_at TEXT,
 ends_at TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','live','closed')),
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE,
 description TEXT DEFAULT '',
 cover TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS photos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT DEFAULT '',
 image_url TEXT NOT NULL,
 category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
 student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS votes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id, photo_id)
);
`);

const seed = db.prepare('SELECT COUNT(*) AS c FROM categories').get();
if (!seed.c) {
  const insertCat = db.prepare('INSERT INTO categories(name,description) VALUES(?,?)');
  ['Campus Life','Nature & Landscape','Portraits','Architecture','Mobile Photography','Open Category'].forEach((n,i)=>insertCat.run(n,['People, moments and stories from campus life.','Landscapes, weather, light and natural beauty.','Faces, emotions and human stories.','Lines, spaces, structures and design.','Creative work captured on a phone.','Anything that deserves to be seen.'][i]));
}
if (!db.prepare('SELECT COUNT(*) AS c FROM competitions').get().c) {
  db.prepare('INSERT INTO competitions(title,theme,description,starts_at,ends_at,status) VALUES(?,?,?,?,?,?)').run('IEM Photography Competition 2026','Through Your Lens','Capture the campus, the city and the moments that usually go unnoticed.','2026-10-01T00:00:00.000Z','2026-10-31T18:30:00.000Z','live');
}
const adminEmail='organizer@iem.local';
if (!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role,college) VALUES(?,?,?,?,?)').run('IEM Competition Team',adminEmail,bcrypt.hashSync('ChangeMe123!',10),'organizer','IEM/UEM');
}
const studentEmail='student@iem.local';
if (!db.prepare('SELECT id FROM users WHERE email=?').get(studentEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role,college) VALUES(?,?,?,?,?)').run('Demo Student',studentEmail,bcrypt.hashSync('ChangeMe123!',10),'student','IEM/UEM');
}

const demoCompetition=db.prepare('SELECT id FROM competitions ORDER BY id DESC LIMIT 1').get();
const demoStudent=db.prepare("SELECT id FROM users WHERE email='student@iem.local'").get();
if (demoCompetition && demoStudent && !db.prepare('SELECT id FROM photos LIMIT 1').get()) {
  const catRows=db.prepare('SELECT id,name FROM categories ORDER BY id').all();
  const addDemo=db.prepare('INSERT INTO photos(title,description,image_url,category_id,student_id,competition_id) VALUES(?,?,?,?,?,?)');
  const demos=[['Campus Light','A warm campus moment after the last lecture.','/uploads/campus.svg'],['After Rain','A quiet landscape after an afternoon shower.','/uploads/nature.svg'],['Quiet Portrait','A portrait built around natural expression and light.','/uploads/portrait.svg'],['Lines & Light','Architecture becomes geometry when the sun moves.','/uploads/architecture.svg'],['Pocket Stories','A mobile frame from an ordinary walk.','/uploads/mobile.svg'],['Unexpected','A frame that found its own story.','/uploads/open.svg']];
  demos.forEach((d,i)=>addDemo.run(d[0],d[1],d[2],catRows[i]?.id||catRows[0].id,demoStudent.id,demoCompetition.id));
}

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({limit:'2mb'}));
app.use('/uploads', express.static(UPLOAD_DIR));

const JWT_SECRET = process.env.JWT_SECRET || 'iem-photography-dev-secret-change-this';
const PORT = Number(process.env.PORT || 4000);
const API_ORIGIN = process.env.PUBLIC_API_URL || `http://localhost:${PORT}`;

function tokenFor(user){ return jwt.sign({id:user.id,role:user.role,email:user.email,name:user.name}, JWT_SECRET, {expiresIn:'7d'}); }
function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Authentication required'});
  try{ req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Invalid or expired session'}); }
}
function role(name){ return (req,res,next)=>{ if(req.user?.role!==name) return res.status(403).json({error:'Organizer access required'}); next(); }; }
function publicPhoto(row){ return {...row, image_url: row.image_url.startsWith('http') ? row.image_url : `${API_ORIGIN}${row.image_url}`}; }

function getActiveCompetition(){ return db.prepare('SELECT * FROM competitions ORDER BY id DESC LIMIT 1').get(); }
function votingIsOpen(competition){
  if(!competition || competition.status !== 'live') return false;
  const now=Date.now();
  if(competition.starts_at && !Number.isNaN(new Date(competition.starts_at).getTime()) && now < new Date(competition.starts_at).getTime()) return false;
  if(competition.ends_at && !Number.isNaN(new Date(competition.ends_at).getTime()) && now > new Date(competition.ends_at).getTime()) return false;
  return true;
}

const upload = multer({
  storage: multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>{
    const ext=path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,10)}${ext}`);
  }}),
  limits:{fileSize: 8*1024*1024},
  fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

app.get('/api/health',(req,res)=>res.json({ok:true,service:'iem-photography-api',time:new Date().toISOString()}));

app.post('/api/auth/register',(req,res)=>{
  const s=z.object({name:z.string().min(2),email:z.email(),password:z.string().min(8),college:z.string().min(2).default('IEM/UEM')});
  const p=s.safeParse(req.body); if(!p.success) return res.status(400).json({error:'Enter a valid name, email and password (8+ characters).'});
  const existing=db.prepare('SELECT id FROM users WHERE email=?').get(p.data.email.toLowerCase());
  if(existing) return res.status(409).json({error:'An account with this email already exists.'});
  const info=db.prepare('INSERT INTO users(name,email,password_hash,role,college) VALUES(?,?,?,?,?)').run(p.data.name,p.data.email.toLowerCase(),bcrypt.hashSync(p.data.password,10),'student',p.data.college);
  const user=db.prepare('SELECT id,name,email,role,college FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({token:tokenFor(user),user});
});

app.post('/api/auth/login',(req,res)=>{
  const p=z.object({email:z.email(),password:z.string().min(1),portal:z.enum(['student','organizer']).default('student')}).safeParse(req.body);
  if(!p.success) return res.status(400).json({error:'Invalid login details'});
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(p.data.email.toLowerCase());
  if(!user || !bcrypt.compareSync(p.data.password,user.password_hash)) return res.status(401).json({error:'Email or password is incorrect.'});
  if(p.data.portal==='organizer' && user.role!=='organizer') return res.status(403).json({error:'This account is not an organizer account.'});
  if(p.data.portal==='student' && user.role!=='student') return res.status(403).json({error:'Use the organizer portal for this account.'});
  const safe={id:user.id,name:user.name,email:user.email,role:user.role,college:user.college};
  res.json({token:tokenFor(safe),user:safe});
});

app.get('/api/competition',(req,res)=>{
  const competition=db.prepare('SELECT * FROM competitions ORDER BY id DESC LIMIT 1').get();
  res.json(competition);
});
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT * FROM categories ORDER BY id').all()));

app.get('/api/photos',(req,res)=>{
  const categoryId=Number(req.query.categoryId||0);
  const q=String(req.query.q||'').trim();
  let sql=`SELECT p.*, c.name category_name, u.name student_name,
    (SELECT COUNT(*) FROM votes v WHERE v.photo_id=p.id) vote_count
    FROM photos p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.student_id`;
  const where=[]; const args=[];
  if(categoryId){where.push('p.category_id=?');args.push(categoryId);}
  if(q){where.push('(p.title LIKE ? OR p.description LIKE ? OR u.name LIKE ?)');args.push(`%${q}%`,`%${q}%`,`%${q}%`);}
  if(where.length) sql+=' WHERE '+where.join(' AND ');
  sql+=' ORDER BY p.id DESC';
  res.json(db.prepare(sql).all(...args).map(publicPhoto));
});

app.get('/api/photos/mine',auth,role('student'),(req,res)=>res.json(db.prepare(`SELECT p.*,c.name category_name,(SELECT COUNT(*) FROM votes v WHERE v.photo_id=p.id) vote_count FROM photos p JOIN categories c ON c.id=p.category_id WHERE p.student_id=? ORDER BY p.id DESC`).all(req.user.id).map(publicPhoto)));

app.post('/api/photos/:id/vote',auth,role('student'),(req,res)=>{
  const id=Number(req.params.id);
  const competition=getActiveCompetition();
  if(!votingIsOpen(competition)) return res.status(403).json({error:'Voting is currently closed.'});
  const photo=db.prepare('SELECT id,competition_id FROM photos WHERE id=?').get(id);
  if(!photo) return res.status(404).json({error:'Photo not found'});
  if(photo.competition_id!==competition.id) return res.status(400).json({error:'This photo is not part of the active competition.'});
  try{ db.prepare('INSERT INTO votes(student_id,photo_id) VALUES(?,?)').run(req.user.id,id); }
  catch(e){ if(String(e.message).includes('UNIQUE')) return res.status(409).json({error:'You have already voted for this photo.'}); throw e; }
  const count=db.prepare('SELECT COUNT(*) c FROM votes WHERE photo_id=?').get(id).c;
  res.json({ok:true,vote_count:count});
});

app.get('/api/my-votes',auth,role('student'),(req,res)=>res.json(db.prepare('SELECT photo_id FROM votes WHERE student_id=?').all(req.user.id).map(x=>x.photo_id)));

app.get('/api/results',(req,res)=>{
  const competition=getActiveCompetition();
  if(!competition) return res.json({competition:null,available:false,leaderboard:[],overallWinners:[],categoryWinners:[]});
  if(competition.status!=='closed') return res.json({competition,available:false,message:'Results will be published after voting closes.',leaderboard:[],overallWinners:[],categoryWinners:[]});
  const rows=db.prepare(`SELECT p.id,p.title,p.image_url,p.description,c.name category_name,u.name student_name,COUNT(v.id) vote_count
    FROM photos p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.student_id
    LEFT JOIN votes v ON v.photo_id=p.id WHERE p.competition_id=? GROUP BY p.id ORDER BY vote_count DESC,p.id ASC`).all(competition.id).map(publicPhoto);
  const overallWinners=rows.slice(0,3);
  const categoryWinners=[]; const seen=new Set();
  for(const row of rows){ if(!seen.has(row.category_name)){categoryWinners.push(row);seen.add(row.category_name);} }
  res.json({competition,available:true,leaderboard:rows,overallWinners,categoryWinners});
});

app.get('/api/organizer/results',auth,role('organizer'),(req,res)=>{
  const competition=getActiveCompetition();
  if(!competition) return res.json({competition:null,leaderboard:[],overallWinners:[],categoryWinners:[]});
  const rows=db.prepare(`SELECT p.id,p.title,p.image_url,p.description,c.name category_name,u.name student_name,COUNT(v.id) vote_count
    FROM photos p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.student_id
    LEFT JOIN votes v ON v.photo_id=p.id WHERE p.competition_id=? GROUP BY p.id ORDER BY vote_count DESC,p.id ASC`).all(competition.id).map(publicPhoto);
  const overallWinners=rows.slice(0,3); const categoryWinners=[]; const seen=new Set();
  for(const row of rows){ if(!seen.has(row.category_name)){categoryWinners.push(row);seen.add(row.category_name);} }
  res.json({competition,leaderboard:rows,overallWinners,categoryWinners});
});

app.get('/api/organizer/stats',auth,role('organizer'),(req,res)=>{
  const photos=db.prepare('SELECT COUNT(*) c FROM photos').get().c;
  const votes=db.prepare('SELECT COUNT(*) c FROM votes').get().c;
  const students=db.prepare("SELECT COUNT(*) c FROM users WHERE role='student'").get().c;
  const categories=db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  res.json({photos,votes,students,categories,votingOpen:votingIsOpen(getActiveCompetition())});
});

app.get('/api/organizer/photos',auth,role('organizer'),(req,res)=>res.json(db.prepare(`SELECT p.*,c.name category_name,u.name student_name,u.email student_email,(SELECT COUNT(*) FROM votes v WHERE v.photo_id=p.id) vote_count FROM photos p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.student_id ORDER BY p.id DESC`).all().map(publicPhoto)));

app.post('/api/organizer/categories',auth,role('organizer'),(req,res)=>{
  const p=z.object({name:z.string().min(2),description:z.string().default('')}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Category name is required'});
  try{const x=db.prepare('INSERT INTO categories(name,description) VALUES(?,?)').run(p.data.name,p.data.description);res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(x.lastInsertRowid));}
  catch{return res.status(409).json({error:'Category already exists'});}
});

app.post('/api/organizer/competition',auth,role('organizer'),(req,res)=>{
  const p=z.object({title:z.string().min(3),theme:z.string().min(2),description:z.string().default(''),starts_at:z.string().optional(),ends_at:z.string().optional(),status:z.enum(['draft','live','closed'])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Invalid competition settings'});
  const x=db.prepare('INSERT INTO competitions(title,theme,description,starts_at,ends_at,status) VALUES(?,?,?,?,?,?)').run(p.data.title,p.data.theme,p.data.description,p.data.starts_at||null,p.data.ends_at||null,p.data.status);
  res.status(201).json(db.prepare('SELECT * FROM competitions WHERE id=?').get(x.lastInsertRowid));
});

app.patch('/api/organizer/competition/:id/status',auth,role('organizer'),(req,res)=>{
  const p=z.object({status:z.enum(['draft','live','closed'])}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Invalid status'});
  db.prepare('UPDATE competitions SET status=? WHERE id=?').run(p.data.status,Number(req.params.id));
  res.json(db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(req.params.id)));
});

app.post('/api/organizer/photos',auth,role('organizer'),upload.single('image'),(req,res)=>{
  const title=String(req.body.title||'Untitled').trim();
  const categoryId=Number(req.body.categoryId);
  const studentId=Number(req.body.studentId);
  const competitionId=Number(req.body.competitionId);
  if(!req.file || !title || !categoryId || !studentId || !competitionId) return res.status(400).json({error:'Title, category, student, competition and image are required.'});
  const imageUrl=`/uploads/${req.file.filename}`;
  const x=db.prepare('INSERT INTO photos(title,description,image_url,category_id,student_id,competition_id) VALUES(?,?,?,?,?,?)').run(title,String(req.body.description||''),imageUrl,categoryId,studentId,competitionId);
  res.status(201).json(publicPhoto(db.prepare(`SELECT p.*,c.name category_name,u.name student_name,(SELECT COUNT(*) FROM votes v WHERE v.photo_id=p.id) vote_count FROM photos p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.student_id WHERE p.id=?`).get(x.lastInsertRowid)));
});

app.post('/api/organizer/import',auth,role('organizer'),(req,res)=>{
  const rows=Array.isArray(req.body.rows)?req.body.rows:[];
  const competitionId=Number(req.body.competitionId);
  let inserted=0;
  const stmt=db.prepare('INSERT INTO photos(title,description,image_url,category_id,student_id,competition_id) VALUES(?,?,?,?,?,?)');
  const tx=db.transaction((items)=>{for(const r of items){const cat=db.prepare('SELECT id FROM categories WHERE name=?').get(String(r.category||''));const student=db.prepare("SELECT id FROM users WHERE email=? AND role='student'").get(String(r.email||'').toLowerCase());if(cat&&student&&r.title&&r.imageUrl){stmt.run(r.title,r.description||'',r.imageUrl,cat.id,student.id,competitionId);inserted++;}}});
  try{tx(rows);}catch(e){return res.status(400).json({error:e.message});}
  res.json({ok:true,inserted,total:rows.length});
});

app.get('/api/organizer/students',auth,role('organizer'),(req,res)=>res.json(db.prepare("SELECT id,name,email,college FROM users WHERE role='student' ORDER BY name").all()));

app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'});});
app.listen(PORT,()=>console.log(`IEM Photography API running at ${API_ORIGIN}`));
