const fs=require('node:fs/promises');
const path=require('node:path');
const {homedir}=require('node:os');
const DATA=process.env.ARCBRIDGE_DATA || path.join(homedir(),'Library/Application Support/Arc Bridge');
const LIMIT=1024*1024;
const valid=(id)=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(id);
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}
let profileId;
async function handle(message){
 if(!message||typeof message.type!=='string')throw Error('Invalid message.');
 if(message.type==='hello'){
  if(!valid(message.profileId)||typeof message.label!=='string'||message.label.length>100||typeof message.enabled!=='boolean')throw Error('Invalid receiver.');
  if(profileId&&profileId!==message.profileId)throw Error('Receiver identity cannot change on an open connection.');
  profileId=message.profileId;
  await write(path.join(DATA,'receivers',`${profileId}.json`),{id:profileId,label:message.label,enabled:message.enabled,lastSeen:new Date().toISOString(),groups:message.groups===true});
  return {ok:true};
 }
 if(!profileId)throw Error('Register this Firefox profile first.');
 const receiver=await read(path.join(DATA,'receivers',`${profileId}.json`));
 if(message.type==='poll'){
  if(!receiver?.enabled)return {job:null};
  const names=await fs.readdir(path.join(DATA,'jobs')).catch(()=>[]);
  for(const name of names.filter((v)=>/^[a-zA-Z0-9-]+\.json$/.test(v)).sort()){
   const job=await read(path.join(DATA,'jobs',name));if(!job||job.targetProfileId!==profileId||!job.authorized||job.state!=='queued')continue;
   const report=await read(path.join(DATA,'reports',name));
   if(report?.runToken===job.runToken&&['completed','cancelled','failed','undone','needs-review'].includes(report.status))continue;
   return {job:{id:job.id,runToken:job.runToken,action:job.action,total:job.operations.length}};
  }return {job:null};
 }
 if(!valid(message.id))throw Error('Invalid migration ID.');
 const file=path.join(DATA,'jobs',`${message.id}.json`),job=await read(file);
 if(!job||job.targetProfileId!==profileId||!job.authorized||message.runToken!==job.runToken)throw Error('Migration not authorized for this receiver.');
 if(message.type==='chunk'){
  if(!Number.isInteger(message.offset)||message.offset<0||message.offset>job.operations.length)throw Error('Invalid offset.');
  const operations=[];let bytes=0;
  for(const op of job.operations.slice(message.offset,message.offset+50)){const size=Buffer.byteLength(JSON.stringify(op));if(bytes+size>512000)break;bytes+=size;operations.push(op);}
  if(!operations.length&&message.offset<job.operations.length)throw Error('A migration entry exceeds the native message limit.');
  return {format:job.format,version:job.version,id:job.id,targetProfileId:job.targetProfileId,operations,nextOffset:message.offset+operations.length,total:job.operations.length,cancelRequested:!!job.cancelRequested};
 }
 if(message.type==='status')return {cancelRequested:!!job.cancelRequested};
 if(message.type==='report'){
  const r=message.report;
  if(!r||r.id!==job.id||!['running','completed','cancelled','failed','undone','needs-review'].includes(r.status)||!Number.isInteger(r.done)||r.done<0||r.done>job.operations.length)throw Error('Invalid report.');
  await write(path.join(DATA,'reports',`${job.id}.json`),{id:job.id,runToken:job.runToken,status:r.status,done:r.done,total:job.operations.length,notes:Array.isArray(r.notes)?r.notes.slice(0,20).map((v)=>String(v).slice(0,500)):[],error:r.error?String(r.error).slice(0,500):null,preserved:r.preserved||0,updatedAt:new Date().toISOString()});return {ok:true};
 }
 throw Error('Unknown message type.');
}
let buffer=Buffer.alloc(0),chain=Promise.resolve();
const send=(value)=>{const body=Buffer.from(JSON.stringify(value));if(body.length>LIMIT)throw Error('Response too large.');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([header,body]));};
process.stdin.on('data',(chunk)=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(size>LIMIT){process.exitCode=1;process.stdin.destroy();return;}if(buffer.length<size+4)break;const raw=buffer.subarray(4,size+4).toString('utf8');buffer=buffer.subarray(size+4);chain=chain.then(async()=>{let input;try{input=JSON.parse(raw);send({requestId:input.requestId,...await handle(input)});}catch{send({requestId:input?.requestId,error:'The native request was rejected. Check the connection and migration permissions.'});}}).catch(()=>{process.exitCode=1;});}});
process.stdin.on('end',()=>{void chain.finally(()=>{if(buffer.length)process.exitCode=1;});});
