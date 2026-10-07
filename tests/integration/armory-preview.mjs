import { preview } from 'vite';
import { launch } from 'puppeteer-core';
import fs from 'node:fs';
const dir='work/armory-preview-evidence';fs.mkdirSync(dir,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:4180,strictPort:true}});
const browser=await launch({executablePath:process.env.CHROME_PATH || 'C:/Users/lin4s/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];function check(label,ok,data){results.push({label,ok,data});console.log(ok?'PASS':'FAIL',label,JSON.stringify(data));if(!ok)process.exitCode=1;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=()=>page.evaluate(()=>{const ui=window.game.ui.importScreen,p=ui.armoryPreview;return {mode:p.getMode(),running:p.running,rig:!!p.rig,knifeVisible:p.rig?.knifeGroup.visible,armsVisible:p.rig?.armsScene.visible,skin:p.skinSystem.getPreviewSkinId(),glove:p.rig?.getActiveGloveId(),video:p.skinSystem.getVideoDiagnostics(),videoMuted:p.skinSystem.activeVideo?.element.muted,videoTime:p.skinSystem.activeVideo?.element.currentTime,gameplayVideo:ui.skinSystem.getVideoDiagnostics(),equipped:ui.skinSystem.getEquippedSkinId(),renderer:p.renderer?.uuid,canvasCount:ui.armoryPanel.querySelectorAll('canvas').length,rawMedia:ui.armoryDetailElem.querySelectorAll('img,video').length};});
async function select(slot,id,mode='item'){await page.evaluate(({slot,id,mode})=>{const u=window.game.ui.importScreen;u.switchArmorySlot(slot);u.selectArmoryItem(id);u.armoryPreview.setMode(mode);u.armoryPreview.root.scrollIntoView({block:'center'});},{slot,id,mode});await sleep(1200);}
async function shot(name){await page.$eval('.armory-preview',e=>e.scrollIntoView({block:'center'}));await sleep(200);await (await page.$('.armory-preview')).screenshot({path:`${dir}/${name}.png`});}
try{
 await page.goto('http://127.0.0.1:4180');await page.waitForFunction(()=>window.game?.ui?.importScreen);
 await sleep(1000);check('hidden Armory stays lazy',!(await state()).rig,await state());
 await page.evaluate(()=>{const u=window.game.ui.importScreen;u.show();u.switchModule(3);});
 await page.waitForFunction(()=>window.game.ui.importScreen.armoryPreview.rig!==null);
 await select('karambit','ASTRAL');check('static knife uses real isolated rig',(await state()).knifeVisible&&!(await state()).armsVisible,await state());await shot('knife-item');
 await select('gloves','DROP_GLOVE_CYBER');check('glove item uses real hand materials',!(await state()).knifeVisible&&(await state()).armsVisible,await state());await shot('glove-item');
 // Combined knife+gloves LOADOUT preview removed: a legacy request stays ITEM.
 await select('gloves','DROP_GLOVE_CYBER','loadout');check('legacy loadout request stays ITEM',(await state()).mode==='item'&&!(await state()).knifeVisible&&(await state()).armsVisible,await state());await shot('loadout-removed');
 await select('karambit','SIGNALISM_ARTIFACT');const v=await state();await sleep(1300);const v2=await state();check('selected blade video advances muted',v2.videoMuted===true&&v2.videoTime>v.videoTime,v2);await shot('artifact-item');
 await page.evaluate(()=>{const p=window.game.ui.importScreen.armoryPreview;window.armoryRendererReference=p.renderer;window.armoryVideoReference=p.skinSystem.activeVideo.element;window.armoryVideoTime=window.armoryVideoReference.currentTime;window.game.ui.importScreen.renderArmorySelection();});await sleep(300);
 check('same selection reuses renderer and video',await page.evaluate(()=>{const p=window.game.ui.importScreen.armoryPreview;return p.renderer===window.armoryRendererReference&&p.skinSystem.activeVideo.element===window.armoryVideoReference&&p.skinSystem.activeVideo.element.currentTime>=window.armoryVideoTime;}));
 await select('karambit','PRISM_ARTIFACT');await shot('artifact-prism');
 await select('karambit','ASTRAL');check('static selection releases video',!(await state()).video,await state());
 check('released source is paused and detached',await page.evaluate(()=>window.armoryVideoReference.paused&&!window.armoryVideoReference.getAttribute('src')));
 await select('gloves','DROP_GLOVE_CYBER');await page.evaluate(()=>window.game.ui.importScreen.armoryPreview.update({slot:'gloves',itemId:'DROP_GLOVE_CYBER',equippedKnifeId:'PRISM_ARTIFACT',equippedGloveId:'STANDARD_ISSUE'}));await sleep(200);check('glove item cannot decode hidden knife',!(await state()).video,await state());
 await select('karambit','SIGNALISM_ARTIFACT');await page.evaluate(()=>window.game.ui.importScreen.switchModule(0));await sleep(200);check('leaving stops rendering and decoding',!(await state()).running&&!(await state()).video,await state());
 await page.evaluate(()=>window.game.ui.importScreen.renderArmory());await sleep(200);check('hidden rerender cannot decode',!(await state()).video,await state());
 await page.evaluate(()=>window.game.ui.importScreen.switchModule(3));await page.$eval('.armory-preview',e=>e.scrollIntoView({block:'center'}));await sleep(1200);check('reopening resumes video',(await state()).videoTime>0,await state());
 const end=await state();check('no raw rectangle assets',end.rawMedia===0&&end.canvasCount===1,end);check('gameplay cosmetics untouched',end.equipped==='SIGNAL_CYAN'&&!end.gameplayVideo,end);check('no browser exceptions',errors.length===0,errors);
}catch(e){console.log(e.stack);process.exitCode=1;}finally{fs.writeFileSync(`${dir}/checks.json`,JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.httpServer.close(r));}
