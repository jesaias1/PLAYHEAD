import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import fs from 'node:fs';
const dir=process.env.ARMORY_EVIDENCE_DIR || 'work/armory-2-final-evidence';fs.mkdirSync(dir,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:4182,strictPort:true}});
const browser=await launch({executablePath:process.env.CHROME_PATH || 'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Isolated offline profile: verification cannot create accounts or change cloud rewards.
await page.setRequestInterception(true);page.on('request',r=>r.url().includes('supabase.co')?r.abort():r.continue());

const results=[];function check(label,ok,data){results.push({label,ok,data});console.log(ok?'PASS':'FAIL',label,JSON.stringify(data));if(!ok)process.exitCode=1;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>page.evaluate(()=>{const ui=window.game.ui.importScreen,p=ui.armoryPreview;return {mode:p.getMode(),running:p.running,rig:!!p.rig,knifeVisible:p.rig?.knifeGroup.visible,armsVisible:p.rig?.armsScene.visible,skin:p.skinSystem.getPreviewSkinId(),glove:p.rig?.getActiveGloveId(),video:p.skinSystem.getVideoDiagnostics(),videoMuted:p.skinSystem.activeVideo?.element.muted,videoTime:p.skinSystem.activeVideo?.element.currentTime,gameplayVideo:ui.skinSystem.getVideoDiagnostics(),equipped:ui.skinSystem.getEquippedSkinId(),renderer:p.renderer?.uuid,canvasCount:ui.armoryDetailElem.querySelectorAll('canvas').length,rawMedia:ui.armoryDetailElem.querySelectorAll('img,video').length,collection:ui.armoryCollectionElem?.textContent,rows:[...ui.armoryDetailElem.querySelectorAll('.armory-detail-row')].map(r=>r.textContent)};});
async function select(slot,id,mode='item'){await page.evaluate(({slot,id,mode})=>{const u=window.game.ui.importScreen;u.switchArmorySlot(slot);u.selectArmoryItem(id);u.armoryPreview.setMode(mode);},{slot,id,mode});await sleep(1200);}
async function shot(name){await page.$eval('.armory-preview',e=>e.scrollIntoView({block:'center'}));await sleep(300);await (await page.$('.armory-preview')).screenshot({path:`${dir}/${name}.png`});}
try{
 console.log('nav');await page.goto(process.env.ARMORY_TEST_URL || 'http://127.0.0.1:4182');await page.waitForFunction(()=>window.game?.ui?.importScreen,{timeout:20000});console.log('game ready');
 await sleep(1000);const s0=await state();check('hidden Armory stays lazy',!s0.rig,s0);
 await page.evaluate(()=>{const u=window.game.ui.importScreen;u.show();u.switchModule(3);});console.log('armory shown');
 await page.waitForFunction(()=>window.game.ui.importScreen.armoryPreview.rig!==null,{timeout:25000});console.log('rig ready');
 await select('karambit','ASTRAL');check('static knife uses real isolated rig',(await state()).knifeVisible&&!(await state()).armsVisible,await state());await shot('knife-item-astral');
 await select('gloves','DROP_GLOVE_CYBER');let g=await state();check('glove ITEM uses real hand materials, knife hidden',!g.knifeVisible&&g.armsVisible&&g.rawMedia===0,g);await shot('glove-item-cyber');
 await select('gloves','DROP_GLOVE_AUREATE');await shot('glove-item-aureate');
 await select('gloves','DROP_GLOVE_CRYSTAL');await shot('glove-item-crystal');
 await select('gloves','DROP_GLOVE_CYBER','loadout');let l=await state();check('legacy loadout request stays ITEM (knife hidden)',l.mode==='item'&&!l.knifeVisible&&l.armsVisible&&l.rawMedia===0,l);await shot('loadout-cyber-removed');
 await select('karambit','SIGNALISM_ARTIFACT');const v=await state();await sleep(1300);const v2=await state();check('selected blade video advances muted',v2.videoMuted===true&&v2.videoTime>v.videoTime,v2);check('no raw video rectangle in detail',v2.rawMedia===0,v2);await shot('knife-item-signalism');
 await select('karambit','BLACKSTAR');await shot('knife-item-blackstar');
 await select('karambit','PRISM_STATIC');await shot('knife-item-prism-static');
 await select('karambit','ASTRAL');check('static selection releases video',!(await state()).video,await state());
 check('released video is detached',await page.evaluate(()=>!window.game.ui.importScreen.armoryPreview.skinSystem.activeVideo));
 const coll=await state();check('collection progress excludes WR from knife totals',/KNIVES/.test(coll.collection||'')&&/GLOVES/.test(coll.collection||''),coll.collection);

 await select('karambit','SIGNALISM_ARTIFACT');
 await page.evaluate(()=>window.game.ui.importScreen.switchModule(0));await sleep(300);
 check('hidden preview stops render and video',!(await state()).running&&!(await state()).video,await state());
 await page.evaluate(()=>window.game.ui.importScreen.renderArmory());await sleep(200);
 check('hidden rerender stays stopped',!(await state()).running&&!(await state()).video);
 await page.evaluate(()=>window.game.ui.importScreen.switchModule(3));await sleep(1000);
 const rewardResult=await page.evaluate(()=>{
 const ui=window.game.ui,u=ui.importScreen,d=ui.decodeModal;
 const skin=u.skinSystem.getSkin('SIGNALISM_ARTIFACT');
 // Present a catalogued reward without issuing/opening any drop or changing ownership.
 const reward={kind:'KARAMBIT',item:{id:skin.id},name:skin.name,codename:skin.codename,rarity:skin.rarity,accentTag:skin.paletteTag,isLive:true,skin,sourceRank:'DIAMOND',qualityLabel:'PRISTINE SIGNAL'};
 d.element.classList.remove('hidden');d.revealAward(reward);
 d.preview.root.scrollIntoView({block:'center'});
 return {host:!!d.celebrationCard.querySelector('.decode-reveal-preview'),source:!!d.celebrationCard.querySelector('img,video')};
 });
 await sleep(1600);
 check('reward shows real blade preview and suspends other scene',await page.evaluate(()=>{const ui=window.game.ui,d=ui.decodeModal;return !!d.preview.rig&&d.preview.running&&!ui.importScreen.armoryPreview.running&&d.preview.skinSystem.activeVideo?.element.muted===true&&d.preview.skinSystem.activeVideo.element.currentTime>0;}),rewardResult);
 await (await page.$('.decode-reveal-preview')).screenshot({path:`${dir}/reward-artifact.png`});
 await page.evaluate(()=>window.game.ui.decodeModal.hide());await sleep(200);
 check('reward hide releases video',await page.evaluate(()=>!window.game.ui.decodeModal.preview.running&&!window.game.ui.decodeModal.preview.skinSystem.activeVideo));

 await page.evaluate(()=>{const ui=window.game.ui;ui.decodeModal.setOnComplete(()=>ui.importScreen.renderArmory());ui.decodeModal.showStructuredError();});
 await page.click('#btn-decode-error-close');await sleep(1200);
 check('offline drop close restores Armory preview',await page.evaluate(()=>!window.game.ui.decodeModal.isVisible()&&window.game.ui.importScreen.armoryPreview.running));
 for(const width of [1280,1920]) {
 await page.setViewport({width,height:1000});await select('gloves','DROP_GLOVE_CYBER');await shot(`gloves-${width}`);
 await select('gloves','DROP_GLOVE_CYBER','loadout');await shot(`gloves-loadout-ignored-${width}`);
 }
 await page.setViewport({width:1440,height:1000});
 const socket=await page.evaluate(()=>{const k=window.game.ui.importScreen.armoryPreview.rig.knifeGroup;return {p:k.position.toArray(),r:k.rotation.toArray().slice(0,3),s:k.scale.toArray()};});
 check('gameplay socket calibration retained',JSON.stringify(socket.p)==='[0.0093,0.1107,0.0033]'&&JSON.stringify(socket.r)==='[3.034,0.3737,0.2205]'&&socket.s.every(v=>v===1.011),socket);
 await page.evaluate(()=>{const ui=window.game.ui;ui.importScreen.hide();ui.armoryModal.show();});await sleep(1500);
 check('pause Armory reuses same preview system',await page.evaluate(()=>{const ui=window.game.ui;return ui.armoryModal.preview.running&&!ui.importScreen.armoryPreview.running;}));
 await page.evaluate(()=>window.game.ui.armoryModal.hide());await sleep(200);
 check('pause Armory hide stops video and rendering',await page.evaluate(()=>{const p=window.game.ui.armoryModal.preview;return !p.running&&!p.skinSystem.activeVideo;}));
 const persist=await page.evaluate(async()=>{
   const u=window.game.ui.importScreen;
   const key='playhead.karambit.equippedSkin';
   const before=localStorage.getItem(key);
   // ISOLATED PROFILE ONLY: seed ownership of one REAL, already-catalogued knife
   // in localStorage so the explicit EQUIP button can be exercised. This grants
   // no real account reward; it is a throwaway browser profile that we restore.
   const target=u.skinSystem.getSkins().find(s=>s.dropEligible&&s.id!=='SIGNAL_CYAN');
   const sigKey='playhead.armory.signalDrops';
   const sigRaw=localStorage.getItem(sigKey);
   const sigBefore=sigRaw;
   const prog=sigRaw?JSON.parse(sigRaw):{version:2,awardedRankKeys:[],pendingDropRanks:[],rewardOwnedSkinIds:[],rewardBags:{BRONZE:[],SILVER:[],GOLD:[],DIAMOND:[]},rewardBagCursors:{BRONZE:0,SILVER:0,GOLD:0,DIAMOND:0},rngState:0x504c4159};
   prog.rewardOwnedSkinIds=[...new Set([...(prog.rewardOwnedSkinIds||[]),target.id])];
   localStorage.setItem(sigKey,JSON.stringify(prog));
   // Reload allocates a fresh isolated profile view of ownership.
   return {before,sigBefore,targetId:target.id,seeded:true};
 });
 await page.reload();await page.waitForFunction(()=>window.game?.ui?.importScreen,{timeout:20000});await sleep(500);
 await page.evaluate(()=>{const u=window.game.ui.importScreen;u.show();u.switchModule(3);});await sleep(600);
 const equipRes=await page.evaluate(({targetId})=>{
   const u=window.game.ui.importScreen;
   const key='playhead.karambit.equippedSkin';
   u.selectArmoryItem(targetId);
   const btn=[...u.armoryDetailElem.querySelectorAll('.armory-action-btn')].find(b=>/EQUIP/.test(b.textContent)&&!b.disabled);
   if(!btn) return {ok:false,reason:'no equip button',rows:u.armoryDetailElem.querySelectorAll('.armory-action-btn').length};
   btn.click();
   return {ok:true,after:localStorage.getItem(key),equippedNow:u.skinSystem.getEquippedSkinId(),targetId};
 },{targetId:persist.targetId});
 check('EQUIP persists to local state via explicit button',equipRes.ok&&equipRes.after===equipRes.targetId&&equipRes.equippedNow===equipRes.targetId,equipRes);

 await page.reload();await page.waitForFunction(()=>window.game?.ui?.importScreen,{timeout:20000});
 check('explicit EQUIP survives reload',await page.evaluate(id=>window.game.ui.importScreen.skinSystem.getEquippedSkinId()===id,persist.targetId));
 const restored=await page.evaluate(({before,sigBefore})=>{const key='playhead.karambit.equippedSkin';if(before===null)localStorage.removeItem(key);else localStorage.setItem(key,before);const sigKey='playhead.armory.signalDrops';if(sigBefore===null)localStorage.removeItem(sigKey);else localStorage.setItem(sigKey,sigBefore);return {equipped:localStorage.getItem(key),sig:localStorage.getItem(sigKey)};},{before:persist.before,sigBefore:persist.sigBefore});
 check('equipped/ownership state restored safely',restored.equipped===persist.before&&restored.sig===persist.sigBefore,restored);
 check('no browser exceptions',errors.length===0,errors);
}catch(e){console.log(e.stack);process.exitCode=1;}finally{fs.writeFileSync(`${dir}/checks.json`,JSON.stringify(results,null,2));console.log('errors:',JSON.stringify(errors));await browser.close();await new Promise(r=>server.httpServer.close(r));}
