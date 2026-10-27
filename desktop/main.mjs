import {app,BrowserWindow,ipcMain,dialog,shell,session} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateJob} from '../core/runner.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
if(process.env.ARCBRIDGE_TEST_DATA)app.setPath('userData',process.env.ARCBRIDGE_TEST_DATA);
const data=app.getPath('userData');
let win;
const localRead=async(file)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}};
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${process.pid}.tmp`;await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}
const valid=(id)=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(id);
async function state(){
 const receivers=[];for(const file of(await fs.readdir(path.join(data,'receivers')).catch(()=>[])).filter((v)=>/^[a-zA-Z0-9-]+\.json$/.test(v))){const r=await localRead(path.join(data,'receivers',file));if(r)receivers.push({...r,online:Date.now()-Date.parse(r.lastSeen)<15000});}
 const jobs=[];for(const file of(await fs.readdir(path.join(data,'jobs')).catch(()=>[])).filter((v)=>/^[a-zA-Z0-9-]+\.json$/.test(v))){const j=await localRead(path.join(data,'jobs',file));if(!j)continue;const report=await localRead(path.join(data,'reports',file));jobs.push({id:j.id,targetProfileId:j.targetProfileId,receiverLabel:j.receiverLabel,createdAt:j.createdAt,total:j.operations.length,skipped:j.skipped?.length||0,action:j.action,cancelRequested:!!j.cancelRequested,...(report?.runToken===j.runToken?report:{status:'queued',done:0})});}
 const nativeDir=process.env.ARCBRIDGE_NATIVE_DIR||path.join(os.homedir(),'Library/Application Support/Mozilla/NativeMessagingHosts');
 return {receivers,jobs:jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),bridgeInstalled:!!await localRead(path.join(nativeDir,'dev.arcbridge.json')),firefoxInstalled:await fs.access('/Applications/Firefox.app').then(()=>true,()=>false),version:app.getVersion()};
}
function authorize(event){if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted window.');}
if(process.env.ARCBRIDGE_TEST_DATA)console.log('Arc Bridge main loaded');
app.whenReady().then(async()=>{
 if(process.env.ARCBRIDGE_TEST_DATA)console.log('Arc Bridge application ready');
 await fs.mkdir(data,{recursive:true,mode:0o700});
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win=new BrowserWindow({width:1320,height:920,minWidth:980,minHeight:700,title:'Arc Bridge',backgroundColor:'#f7f7f2',show:false,webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.setMenuBarVisibility(false);
 const index=path.join(app.getAppPath(),'dist/index.html');
 win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{authorize(event);return fn(...args);});
 handle('state',state);
 handle('open',async()=>{const r=await dialog.showOpenDialog(win,{title:'Choose an Arc export or sidebar snapshot',properties:['openFile'],filters:[{name:'Browser export',extensions:['json','html','htm']}]});if(r.canceled)return null;const f=await fs.open(r.filePaths[0],'r');try{const stat=await f.stat();if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Choose an export under 20 MB.');return {name:path.basename(r.filePaths[0]),content:await f.readFile('utf8')};}finally{await f.close();}});
 handle('save',async(name,content)=>{if(typeof content!=='string'||Buffer.byteLength(content)>32*1024*1024||typeof name!=='string')throw Error('Invalid export.');const r=await dialog.showSaveDialog(win,{defaultPath:path.basename(name)});if(r.canceled||!r.filePath)return false;await fs.writeFile(r.filePath,content,{mode:0o600});return true;});
 handle('install',async()=>{
  const dir=process.env.ARCBRIDGE_NATIVE_DIR||path.join(os.homedir(),'Library/Application Support/Mozilla/NativeMessagingHosts');
  await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.mkdir(path.join(data,'bin'),{recursive:true,mode:0o700});
  const quote=(s)=>`'${s.replaceAll("'","'\\''")}'`;
  const host=app.isPackaged?path.join(process.resourcesPath,'native/host.cjs'):path.join(here,'host.cjs');
  const launcher=path.join(data,'bin/arc-bridge-host');
  await fs.writeFile(launcher,`#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexport ARCBRIDGE_DATA=${quote(data)}\nexec ${quote(process.execPath)} ${quote(host)}\n`,{mode:0o700});
  await atomic(path.join(dir,'dev.arcbridge.json'),{name:'dev.arcbridge',description:'Arc Bridge local migration receiver',path:launcher,type:'stdio',allowed_extensions:['arcbridge@local']});return state();
 });
 handle('extension',async()=>{const folder=app.isPackaged?path.join(process.resourcesPath,'extension'):path.join(app.getAppPath(),'dist-extension');await shell.openPath(folder);return true;});
 handle('help',async()=>shell.openExternal('https://support.mozilla.org/en-US/kb/profile-management'));
 handle('stage',async(jobs)=>{
  if(!Array.isArray(jobs)||!jobs.length||jobs.length>50)throw Error('Choose 1–50 destination profiles.');
  const current=await state();
  for(const j of jobs){validateJob(j,j.targetProfileId);if(!valid(j.id)||!current.receivers.some((r)=>r.id===j.targetProfileId&&r.online&&r.enabled))throw Error('A receiver is offline or has not allowed desktop migrations.');if(await localRead(path.join(data,'jobs',`${j.id}.json`)))throw Error('This migration already exists; resume it from History.');}
  for(const j of jobs){const receiver=current.receivers.find((r)=>r.id===j.targetProfileId);await atomic(path.join(data,'jobs',`${j.id}.json`),{...j,receiverLabel:receiver.label,authorized:true,state:'queued',runToken:randomUUID(),action:'migrate',createdAt:new Date().toISOString()});}
  return state();
 });
 handle('control',async(id,action)=>{
  if(!valid(id)||!['cancel','resume','undo'].includes(action))throw Error('Invalid migration action.');const file=path.join(data,'jobs',`${id}.json`);const job=await localRead(file);if(!job)throw Error('Migration not found.');
  if(action==='cancel')job.cancelRequested=true;
  else {const report=await localRead(path.join(data,'reports',`${id}.json`));if(report?.runToken===job.runToken&&report.status==='running')throw Error('Pause this migration and wait for it to stop first.');job.cancelRequested=false;job.runToken=randomUUID();job.action=action==='undo'?'undo':'migrate';job.state='queued';}
  await atomic(file,job);return state();
 });
 handle('report',async()=>{const s=await state();const r=await dialog.showSaveDialog(win,{defaultPath:'arc-bridge-report.json'});if(r.canceled||!r.filePath)return false;await fs.writeFile(r.filePath,JSON.stringify({exportedAt:new Date().toISOString(),jobs:s.jobs},null,2),{mode:0o600});return true;});
 await win.loadFile(index);if(!process.argv.includes('--hidden'))win.show();
 app.on('activate',()=>win?.show());
});
app.on('window-all-closed',()=>app.quit());
