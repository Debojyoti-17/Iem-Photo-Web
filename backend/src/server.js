import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const app=express();
const PORT=Number(process.env.PORT||4000);
const JWT_SECRET=process.env.JWT_SECRET;
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET=process.env.SUPABASE_STORAGE_BUCKET||'competition-photos';
if(!JWT_SECRET||!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
  console.error('Missing JWT_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1);
}
const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(cors({origin:process.env.FRONTEND_ORIGIN||true,credentials:true}));
app.use(express.json({limit:'2mb'}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))});

const cats=[
  ['Campus Life','People, moments and stories from campus life.'],
  ['Nature & Landscape','Landscapes, weather, light and natural beauty.'],
  ['Portraits','Faces, emotions and human stories.'],
  ['Architecture','Lines, spaces, structures and design.'],
  ['Mobile Photography','Creative work captured on a phone.'],
  ['Open Category','Anything that deserves to be seen.']
];
async function seed(){
  const {count:cc}=await db.from('categories').select('*',{count:'exact',head:true});
  if(!cc) await db.from('categories').insert(cats.map(([name,description])=>({name,description})));
  const {count:xc}=await db.from('competitions').select('*',{count:'exact',head:true});
  if(!xc) await db.from('competitions').insert({title:'IEM Photography Competition 2026',theme:'Through Your Lens',description:'Capture the campus, the city and the moments that usually go unnoticed.',starts_at:new Date().toISOString(),ends_at:'2026-10-31T18:30:00.000Z',status:'live'});
  for(const [name,email,password,role] of [['IEM Competition Team','organizer@iem.local','ChangeMe123!','organizer'],['Demo Student','student@iem.local','ChangeMe123!','student']]){
    const {data}=await db.from('users').select('id').eq('email',email).maybeSingle();
    if(!data) await db.from('users').insert({name,email,password_hash:bcrypt.hashSync(password,10),role,college:'IEM/UEM'});
  }
}
const tokenFor=u=>jwt.sign({id:u.id,role:u.role,email:u.email,name:u.name},JWT_SECRET,{expiresIn:'7d'});
function auth(req,res,next){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next()}catch{return res.status(401).json({error:'Invalid or expired session'})}}
const role=r=>(req,res,next)=>req.user?.role===r?next():res.status(403).json({error:'Organizer access required'});
async function competition(){const {data,error}=await db.from('competitions').select('*').order('id',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data}
function votingOpen(c){if(!c||c.status!=='live')return false;const n=Date.now();return (!c.starts_at||n>=new Date(c.starts_at).getTime())&&(!c.ends_at||n<=new Date(c.ends_at).getTime())}
async function photos(categoryId=0){
  let q=db.from('photos').select('*').order('id',{ascending:false}); if(categoryId)q=q.eq('category_id',categoryId);
  const {data,error}=await q;if(error)throw error;
  const [cr,ur,vr]=await Promise.all([db.from('categories').select('id,name,description'),db.from('users').select('id,name,email,college'),db.from('votes').select('photo_id')]);
  if(cr.error)throw cr.error;if(ur.error)throw ur.error;if(vr.error)throw vr.error;
  const cm=new Map((cr.data||[]).map(x=>[x.id,x])),um=new Map((ur.data||[]).map(x=>[x.id,x])),vm=new Map();
  for(const v of vr.data||[])vm.set(v.photo_id,(vm.get(v.photo_id)||0)+1);
  return (data||[]).map(p=>({...p,category_name:cm.get(p.category_id)?.name||'',student_name:um.get(p.student_id)?.name||'',student_email:um.get(p.student_id)?.email||'',vote_count:vm.get(p.id)||0}));
}
async function resultData(){
  const c=await competition(); if(!c)return {competition:null,available:false,leaderboard:[],overallWinners:[],categoryWinners:[]};
  const all=(await photos()).filter(p=>p.competition_id===c.id).sort((a,b)=>b.vote_count-a.vote_count||a.id-b.id);
  if(c.status!=='closed')return {competition:c,available:false,message:'Results will be published after voting closes.',leaderboard:[],overallWinners:[],categoryWinners:[]};
  const seen=new Set(),categoryWinners=[];for(const p of all)if(!seen.has(p.category_id)){seen.add(p.category_id);categoryWinners.push(p)}
  return {competition:c,available:true,leaderboard:all,overallWinners:all.slice(0,3),categoryWinners};
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'iem-photography-api',time:new Date().toISOString()}));
app.post('/api/auth/register',async(req,res)=>{try{const p=z.object({name:z.string().min(2),email:z.email(),password:z.string().min(8),college:z.string().min(2).default('IEM/UEM')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter a valid name, email and password (8+ characters).'});const email=p.data.email.toLowerCase();const {data:e}=await db.from('users').select('id').eq('email',email).maybeSingle();if(e)return res.status(409).json({error:'An account with this email already exists.'});const {data:u,error}=await db.from('users').insert({name:p.data.name,email,password_hash:bcrypt.hashSync(p.data.password,10),role:'student',college:p.data.college}).select('id,name,email,role,college').single();if(error)throw error;res.status(201).json({token:tokenFor(u),user:u})}catch(e){console.error(e);res.status(500).json({error:'Server error'})}});
app.post('/api/auth/login',async(req,res)=>{try{const p=z.object({email:z.email(),password:z.string().min(1),portal:z.enum(['student','organizer']).default('student')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid login details'});const {data:u}=await db.from('users').select('*').eq('email',p.data.email.toLowerCase()).maybeSingle();if(!u||!bcrypt.compareSync(p.data.password,u.password_hash))return res.status(401).json({error:'Email or password is incorrect.'});if(u.role!==p.data.portal)return res.status(403).json({error:`Use the ${u.role==='organizer'?'organizer':'student'} portal for this account.`});const user={id:u.id,name:u.name,email:u.email,role:u.role,college:u.college};res.json({token:tokenFor(user),user})}catch(e){console.error(e);res.status(500).json({error:'Server error'})}});
app.get('/api/competition',async(req,res)=>{try{res.json(await competition())}catch(e){res.status(500).json({error:'Server error'})}});
app.get('/api/categories',async(req,res)=>{const {data,error}=await db.from('categories').select('*').order('id');if(error)return res.status(500).json({error:'Server error'});res.json(data||[])});
app.get('/api/photos',async(req,res)=>{try{let r=await photos(Number(req.query.categoryId||0));const q=String(req.query.q||'').trim().toLowerCase();if(q)r=r.filter(p=>`${p.title} ${p.description} ${p.student_name} ${p.category_name}`.toLowerCase().includes(q));res.json(r)}catch(e){console.error(e);res.status(500).json({error:'Server error'})}});
app.get('/api/photos/mine',auth,role('student'),async(req,res)=>{try{res.json((await photos()).filter(p=>p.student_id===req.user.id))}catch(e){res.status(500).json({error:'Server error'})}});
app.get('/api/my-votes',auth,role('student'),async(req,res)=>{const {data,error}=await db.from('votes').select('photo_id').eq('student_id',req.user.id);if(error)return res.status(500).json({error:'Server error'});res.json((data||[]).map(x=>x.photo_id))});
app.post('/api/photos/:id/vote',auth,role('student'),async(req,res)=>{try{const c=await competition();if(!votingOpen(c))return res.status(403).json({error:'Voting is currently closed.'});const {data:p}=await db.from('photos').select('id,competition_id').eq('id',Number(req.params.id)).maybeSingle();if(!p)return res.status(404).json({error:'Photo not found'});if(p.competition_id!==c.id)return res.status(400).json({error:'This photo is not part of the active competition.'});const {error}=await db.from('votes').insert({student_id:req.user.id,photo_id:p.id});if(error){if(error.code==='23505')return res.status(409).json({error:'You have already voted for this photo.'});throw error}const {count}=await db.from('votes').select('*',{count:'exact',head:true}).eq('photo_id',p.id);res.json({ok:true,vote_count:count||0})}catch(e){console.error(e);res.status(500).json({error:'Server error'})}});
app.get('/api/results',async(req,res)=>{try{res.json(await resultData())}catch(e){console.error(e);res.status(500).json({error:'Server error'})}});
app.get('/api/organizer/results',auth,role('organizer'),async(req,res)=>{try{res.json(await resultData())}catch(e){res.status(500).json({error:'Server error'})}});
app.get('/api/organizer/photos',auth,role('organizer'),async(req,res)=>{try{res.json(await photos())}catch(e){res.status(500).json({error:'Server error'})}});
app.get('/api/organizer/students',auth,role('organizer'),async(req,res)=>{const {data,error}=await db.from('users').select('id,name,email,college').eq('role','student').order('name');if(error)return res.status(500).json({error:'Server error'});res.json(data||[])});
app.get('/api/organizer/stats',auth,role('organizer'),async(req,res)=>{try{const [p,v,s,c]=await Promise.all([db.from('photos').select('*',{count:'exact',head:true}),db.from('votes').select('*',{count:'exact',head:true}),db.from('users').select('*',{count:'exact',head:true}).eq('role','student'),db.from('categories').select('*',{count:'exact',head:true})]);res.json({photos:p.count||0,votes:v.count||0,students:s.count||0,categories:c.count||0,votingOpen:votingOpen(await competition())})}catch(e){res.status(500).json({error:'Server error'})}});
app.post('/api/organizer/categories',auth,role('organizer'),async(req,res)=>{const p=z.object({name:z.string().min(2),description:z.string().default('')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Category name is required'});const {data,error}=await db.from('categories').insert(p.data).select().single();if(error)return res.status(400).json({error:error.code==='23505'?'Category already exists.':error.message});res.status(201).json(data)});
app.patch('/api/organizer/competition/:id/status',auth,role('organizer'),async(req,res)=>{const p=z.object({status:z.enum(['draft','live','closed'])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid status'});const {data,error}=await db.from('competitions').update({status:p.data.status}).eq('id',Number(req.params.id)).select().single();if(error)return res.status(400).json({error:error.message});res.json(data)});
app.post('/api/organizer/competition',auth,role('organizer'),async(req,res)=>{const p=z.object({title:z.string().min(3),theme:z.string().min(2),description:z.string().default(''),starts_at:z.string().optional(),ends_at:z.string().optional(),status:z.enum(['draft','live','closed'])}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid competition settings'});const {data,error}=await db.from('competitions').insert(p.data).select().single();if(error)return res.status(400).json({error:error.message});res.status(201).json(data)});
app.post('/api/organizer/photos',auth,role('organizer'),upload.single('image'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'Please choose a JPEG, PNG or WebP image.'});const title=String(req.body.title||'').trim(),categoryId=Number(req.body.categoryId),studentId=Number(req.body.studentId),competitionId=Number(req.body.competitionId);if(!title||!categoryId||!studentId||!competitionId)return res.status(400).json({error:'Title, student, category and competition are required.'});const ext=req.file.mimetype==='image/jpeg'?'jpg':req.file.mimetype.split('/')[1];const objectPath=`competition-${competitionId}/${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;const {error:ue}=await db.storage.from(BUCKET).upload(objectPath,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(ue)throw ue;const {data:url}=db.storage.from(BUCKET).getPublicUrl(objectPath);const {data:p,error}=await db.from('photos').insert({title,description:String(req.body.description||''),image_url:url.publicUrl,category_id:categoryId,student_id:studentId,competition_id:competitionId}).select().single();if(error)throw error;res.status(201).json((await photos()).find(x=>x.id===p.id))}catch(e){console.error(e);res.status(500).json({error:'Could not publish photo. Check the Supabase Storage bucket and database settings.'})}});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Server error'})});
seed().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`IEM Photography API running on port ${PORT}`))).catch(e=>{console.error('Startup failed',e);process.exit(1)});
