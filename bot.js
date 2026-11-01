const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
let settings = JSON.parse(fs.readFileSync('./settings.json'));
const { CATEGORIES, AUTO_REPLIES, getRandomPhoto, getLogo, getMenuPhoto, safeSendImageReply, getWelcome, getMainMenu, getPlatformMenu, getCategoryDetail, getSettingMenu, getAthalMenu } = require('./lib/menu');
const { downloadAndSend } = require('./lib/downloader');

const EXTRA_OWNER = "94729497699";
let BOT_NUMBER = "";
let pendingQuality=new Map(); let processedIds=new Set(); let isConnected=false; let isFirstStart=true;

async function startBot(pairNumber=null){
const { state, saveCreds } = await useMultiFileAuthState('auth_info');
const { version } = await fetchLatestBaileysVersion();
const sock=makeWASocket({
  version,
  auth:state,
  logger:P({ level: 'silent' }),
  browser:['MIRA-PRIME','Chrome','13.0'],
  printQRInTerminal: false,
  syncFullHistory: false,
  markOnlineOnConnect: false
});

if(pairNumber && !state.creds.registered){
  let num=pairNumber.replace(/[^0-9]/g,'');
  console.log(`\n⏳ Pair Code Requesting for: ${num} ...`);
  setTimeout(async()=>{
    try{
      let code=await sock.requestPairingCode(num);
      console.log(`\n==============================\n🤖 YOUR PAIR CODE: ${code}\n==============================\n`);
    }catch(e){ console.log("Pair Error:", e.message); }
  },4000);
}

sock.ev.on('creds.update',saveCreds);
sock.ev.on('connection.update',async(update)=>{
const {connection,lastDisconnect,qr}=update;
if(qr && !pairNumber){
  console.log("\n📱 QR CODE SCAN කරන්න:\n");
  qrcode.generate(qr, {small: true});
}
if(connection==='close'){ 
  let r=lastDisconnect?.error?.output?.statusCode; 
  if(r!==DisconnectReason.loggedOut) setTimeout(()=>startBot(pairNumber),3000); 
}
if(connection==='open' && !isConnected){
isConnected=true; BOT_NUMBER=sock.user.id.split(':')[0].split('@')[0];
console.log(`\n✅ CONNECTED! Bot: ${BOT_NUMBER} FAST MODE ✅\n`);
// WELCOME ONLY FIRST TIME AFTER CONNECT - LOGO/MENU ONLY HERE
if(isFirstStart){
  isFirstStart=false;
  try{
    let welcomeMsg=getWelcome(BOT_NUMBER, EXTRA_OWNER, settings);
    // FIRST 2 MSGS: Logo + Menu photo only first time
    let logo = getLogo();
    let menuP = getMenuPhoto();
    await safeSendImageReply(sock,BOT_NUMBER+"@s.whatsapp.net",logo,welcomeMsg,null);
    await new Promise(r=>setTimeout(r,800));
    if(EXTRA_OWNER!==BOT_NUMBER) await safeSendImageReply(sock,EXTRA_OWNER+"@s.whatsapp.net",menuP||logo,welcomeMsg,null);
  }catch(e){}
}
}
});

sock.ev.on('messages.upsert', async ({messages})=>{
try{
let msg=messages[0]; if(!msg.message) return;
let jid=msg.key.remoteJid; 
let text=msg.message.conversation||msg.message.extendedTextMessage?.text||msg.message.imageMessage?.caption||""; 
text=text.trim(); if(!text) return;
let low=text.toLowerCase();

// SPEED: ignore old processed
if(processedIds.has(msg.key.id)) return; processedIds.add(msg.key.id); if(processedIds.size>800) processedIds.clear();

// FIXED: ALLOW BOT NUMBER TO USE COMMANDS - OLD CODE BLOCKED IT
// Only block loop messages containing bot signature
if(text.includes("MIRA PRIME") && text.includes("◢◤") && msg.key.fromMe) return;
if(msg.key.fromMe){
  // If fromMe and not a command, ignore to prevent loop
  let isCommand = low.startsWith('.') || low.startsWith('hi') || low.startsWith('menu') || low.startsWith('adult') || text.includes('https://') || /^[1-4]$/.test(low) || ["hi","hello","hey","mira","prime","gn","gm","mk","ela","machan","mchn","ado","bn"].includes(low);
  if(!isCommand) return;
}

const shortMap = {".fb":"fb",".tt":"tiktok",".yt":"yt",".ig":"ig",".tw":"tw",".mp3":"mp3",".mp4":"mp4"};
let first = low.split(' ')[0];

// FAST PATH: DIRECT LINK
if(text.includes('https://') && !first.startsWith('.')){
  const m=text.match(/https?:\/\/[^\s]+/); if(m){
    const url=m[0]; let type="fb"; if(url.includes('tiktok')) type="tiktok"; else if(url.includes('youtu')) type="yt"; else if(url.includes('instagram')) type="ig";
    if(pendingQuality.has(jid)) clearTimeout(pendingQuality.get(jid).timer);
    const timer=setTimeout(async()=>{
      if(pendingQuality.has(jid)){
        let pend=pendingQuality.get(jid); pendingQuality.delete(jid);
        await downloadAndSend(sock,jid,pend.url,"720",pend.originalMsg,pend.type);
      }
    },15000);
    pendingQuality.set(jid,{url,type,originalMsg:msg,timer});
    // NOW RANDOM PHOTO ALWAYS, NOT MENU/LOGO
    await safeSendImageReply(sock,jid,getRandomPhoto(),`📥 LINK DETECTED ULTRA! 🔗💖\n1️⃣ 1080p ✨💎\n2️⃣ 720p 💜\n3️⃣ 480p 💛\n4️⃣ 360p 💚\n👉 Reply 1-4 Quality තෝරන්න!\n⏰ 15s Auto 720p! 🚀`,msg);
    return;
  }
}

if(pendingQuality.has(jid) && /^[1-4]$/.test(text)){
  let pend=pendingQuality.get(jid); clearTimeout(pend.timer); pendingQuality.delete(jid);
  let q=text==="1"?"1080":text==="2"?"720":text==="3"?"480":"360";
  await safeSendImageReply(sock,jid,getRandomPhoto(),`✅ ${q}p SELECTED! Downloading... 🚀`,msg);
  await downloadAndSend(sock,jid,pend.url,q,pend.originalMsg,pend.type);
  return;
}

if(shortMap[first]){
  let args=text.trim().split(' ').slice(1); let quality=settings.defaultQuality; let url="";
  if(args.length>=2 && /^\d+$/.test(args[0])){ quality=args[0]; url=args.slice(1).join(' '); } else { url=args.join(' '); }
  const m=url.match(/https?:\/\/[^\s]+/); if(m) url=m[0];
  if(!url.startsWith('http')){ await safeSendImageReply(sock,jid,getRandomPhoto(),`❌ Link එක දාන්න: ${first} <https://...>`,msg); return; }
  await downloadAndSend(sock,jid,url,quality,msg,shortMap[first]);
  return;
}

// MENU - NOW ALWAYS RANDOM PHOTO
if(["hi","hello","hey","mira","prime"].includes(low)){
  await safeSendImageReply(sock,jid,getRandomPhoto(),getMainMenu(BOT_NUMBER, EXTRA_OWNER, settings),msg); return;
}
if(low==="menu" || low===".menu"){
  await safeSendImageReply(sock,jid,getRandomPhoto(),getPlatformMenu(settings),msg); return;
}
let menuMatch = low.match(/^\.menu\s+(\d{1,2})$/);
if(menuMatch){ await safeSendImageReply(sock,jid,getRandomPhoto(),getCategoryDetail(menuMatch[1], settings),msg); return; }

if(low.startsWith(".photo")){ 
  let rp=getRandomPhoto(); 
  if(rp) await safeSendImageReply(sock,jid,rp,`📸 Random Photo 🤩\nMIRA PRIME ✨`,msg); 
  return; 
}
if(low===".logo"){ 
  await safeSendImageReply(sock,jid,getLogo(),`🤖 MIRA LOGO ✨`,msg); return; 
}
if(low.startsWith(".setting")||low==="setting"){ 
  // SETTING MENU USES LOGO ONLY
  await safeSendImageReply(sock,jid,getLogo(),getSettingMenu(BOT_NUMBER, EXTRA_OWNER, settings),msg); return; 
}
if(low===".athal"){ await safeSendImageReply(sock,jid,getRandomPhoto(),getAthalMenu(EXTRA_OWNER, BOT_NUMBER),msg); return; }
if(low.startsWith("adult ")){ settings.adultEnabled=low.split(" ")[1]==="on"; fs.writeFileSync('./settings.json', JSON.stringify(settings,null,2)); await safeSendImageReply(sock,jid,getRandomPhoto(),`✅ Adult ${settings.adultEnabled?"ON - 17 Cats":"OFF - 16 Cats"} 🔞`,msg); return; }

// AUTO REPLIES - INSTANT, NO DELAY
for(let key in AUTO_REPLIES){
  if(low===key || low.startsWith(key+" ") || low.endsWith(" "+key)){
    let r=AUTO_REPLIES[key]; let reply=r[Math.floor(Math.random()*r.length)];
    await safeSendImageReply(sock,jid,getRandomPhoto(),reply,msg);
    if(["mk","gn","gm","hi","hello","machan","mchn","ado","bn","ela"].includes(key)) return;
  }
}

}catch(e){ console.log("Error:",e.message); }
});
}
let args=process.argv; let pairIndex=args.indexOf("--pair"); let pairNum=null; if(pairIndex!==-1&&args[pairIndex+1]) pairNum=args[pairIndex+1];
startBot(pairNum);
console.log("\n🤖 MIRA PRIME v14 ULTRA FAST - Starting...\n⚡ Self-Chat FIXED | Random Photos FIXED | Speed 10x!\n");
