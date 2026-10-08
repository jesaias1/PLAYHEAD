import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyOrbitDrag, applyOrbitKeys, buildRetainedGloveGeometry, orbitCameraPosition } from '../src/ui/ArmoryPreview';
import { KarambitSkinSystem } from '../src/viewmodel/KarambitSkinSystem';
import { GloveTextureCache, GloveTextureSwitcher, resolveGloveTexturePath } from '../src/viewmodel/GloveTextures';

afterEach(() => vi.unstubAllGlobals());

describe('Armory inspection geometry and orbit', () => {
  it('retains only the right hand and frames posed vertices in world space without modifying the source', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([.1,0,0, .2,.1,0, .1,.2,0, -.4,0,0, -.3,.1,0, -.4,.2,0, .01,0,0, .02,.01,0, .01,.02,0],3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array(9).fill([0,0,1]).flat(),3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 2,0,0,0, 2,0,0,0, 2,0,0,0],4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array(9).fill([1,0,0,0]).flat(),4));
    geometry.setIndex([0,1,2,3,4,5,6,7,8]);
    const bones = ['handR','handL','forearmR'].map(name => { const bone = new THREE.Bone(); bone.name=name; return bone; });
    const mesh = new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
    const parent = new THREE.Group(); parent.position.set(5,2,3); parent.scale.setScalar(2); parent.add(mesh,...bones); parent.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    const result = buildRetainedGloveGeometry(mesh,bones[0],new Set(['handR']))!;
    expect(result.keptTriangles).toBe(1);
    expect(Array.from(result.filteredGeometry.index!.array)).toEqual([0,1,2]);
    expect(result.retainedWorldBox.min.x).toBeCloseTo(5.2);
    expect(result.retainedWorldBox.max.y).toBeCloseTo(2.4);
    expect(geometry.index!.count).toBe(9);
    expect(result.filteredGeometry.getAttribute('normal').array).toEqual(geometry.getAttribute('normal').array);
    result.filteredGeometry.dispose(); geometry.dispose();
  });
  it('orbits around the fitted subject at a constant distance and bounds vertical input', () => {
    const center = new THREE.Vector3(4,2,-3);
    const angles = applyOrbitDrag({yaw:0,pitch:0},.5,20);
    const point = orbitCameraPosition(center,new THREE.Vector3(0,0,1),.4,angles,new THREE.Vector3());
    expect(point.distanceTo(center)).toBeCloseTo(.4);
    expect(angles.pitch).toBeLessThan(1);
    const copy = {...angles};
    orbitCameraPosition(center,new THREE.Vector3(0,0,1),.4,angles,new THREE.Vector3());
    expect(angles).toEqual(copy);
    expect(applyOrbitKeys(angles,0,-20).pitch).toBeGreaterThan(-1);
  });
});

function deferredTextures() {
  const calls: Array<{texture: THREE.Texture; done: () => void; fail: () => void}> = [];
  const loader = {load: (_url:string,onLoad:(texture:THREE.Texture)=>void,_progress:undefined,onError:(error?:unknown)=>void) => {
    const texture = new THREE.Texture();
    calls.push({texture,done:()=>{texture.image={width:1,height:1};onLoad(texture);},fail:()=>onError(new Error('missing'))});
    return texture;
  }};
  return {loader,calls};
}

describe('Cosmetic asynchronous ownership', () => {
  it('rejects an old same-skin request after switching away and back, and after disposal', () => {
    const preview = KarambitSkinSystem.createPreviewInstance();
    vi.stubGlobal('document',{});
    const {loader,calls}=deferredTextures();
    (preview as unknown as {textureLoader:typeof loader}).textureLoader=loader;
    preview.setPreviewSkin('ASTRAL');
    preview.setPreviewSkin('VOID_SIGNAL');
    preview.setPreviewSkin('ASTRAL');
    const listener=vi.fn(); preview.addListener(listener);
    calls[0].done(); expect(listener).not.toHaveBeenCalled();
    expect(preview.getTextureStatus('ASTRAL')).toBe('pending');
    calls[2].done(); expect(listener).toHaveBeenCalledTimes(1);
    expect(preview.getTextureStatus('ASTRAL')).toBe('ok');
    preview.dispose(); calls[1].done();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(preview.getResidentTextureCount()).toBe(0);
  });
  it('evicts a failed knife texture so selecting it again retries', () => {
    const preview=KarambitSkinSystem.createPreviewInstance(); vi.stubGlobal('document',{});
    const {loader,calls}=deferredTextures(); (preview as unknown as {textureLoader:typeof loader}).textureLoader=loader;
    preview.setPreviewSkin('ASTRAL');
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    calls[0].fail(); expect(preview.getTextureStatus('ASTRAL')).toBe('error');
    preview.getSkinTexture('ASTRAL'); expect(calls).toHaveLength(2);
    calls[1].done(); expect(preview.getTextureStatus('ASTRAL')).toBe('ok');
    preview.dispose(); warn.mockRestore();
  });
  it('a cleared glove cache rejects late success and old errors do not erase a newer request', async () => {
    const {loader,calls}=deferredTextures(); const cache=new GloveTextureCache(t=>t,loader);
    const path=resolveGloveTexturePath('FIRST_CONTACT');
    const old=cache.load(path); cache.clear(); const fresh=cache.load(path);
    calls[0].fail(); expect(cache.getStatus(path)).toBe('loading');
    expect(cache.load(path)).toBe(fresh);
    calls[1].done(); expect(await fresh).toBe(calls[1].texture); expect(await old).toBeNull();
    cache.clear(); const stale=cache.load(path); cache.clear();
    const dispose=vi.spyOn(calls[2].texture,'dispose'); calls[2].done();
    expect(await stale).toBeNull(); expect(dispose).toHaveBeenCalled(); expect(cache.size()).toBe(0);
  });
  it('uses an honest base fallback while loading and only applies the most recent glove', async () => {
    const {loader,calls}=deferredTextures(); const cache=new GloveTextureCache(t=>t,loader);
    const switcher=new GloveTextureSwitcher(cache); const base=new THREE.Texture(); const apply=vi.fn();
    const first=switcher.apply('FIRST_CONTACT',base,apply);
    expect(apply).toHaveBeenLastCalledWith(base,false);
    const latest=switcher.apply('SIGNAL_RUNNER',base,apply);
    calls[1].done(); await latest; calls[0].done(); await first;
    expect(apply).toHaveBeenLastCalledWith(calls[1].texture,true);
    cache.clear(); base.dispose();
  });
});


describe('Preview pointer lifecycle', () => {
  class ElementStub extends EventTarget {
    style: Record<string,string> = {};
    className=''; textContent=''; tabIndex=0; parentElement:ElementStub|null=null;
    clientWidth=100; clientHeight=100;
    classList={add:vi.fn(),remove:vi.fn()};
    captures=new Set<number>();
    setAttribute=vi.fn();
    appendChild(child:ElementStub) { child.parentElement=this; }
    setPointerCapture(id:number) {this.captures.add(id);}
    hasPointerCapture(id:number) {return this.captures.has(id);}
    releasePointerCapture(id:number) {this.captures.delete(id);}
    remove() {this.parentElement=null;}
  }
  it('keeps user rotation, resets it, and cancels dragging on hide and dispose', async () => {
    const doc=new EventTarget() as EventTarget & {createElement:()=>ElementStub;hidden:boolean};
    doc.createElement=()=>new ElementStub(); doc.hidden=false; vi.stubGlobal('document',doc);
    const {ArmoryPreview}=await import('../src/ui/ArmoryPreview');
    const preview=new ArmoryPreview();
    const canvas=(preview as unknown as {canvas:ElementStub}).canvas;
    const pointer=(type:string,x:number)=>canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:0}));
    pointer('pointerdown',0); pointer('pointermove',25);
    expect(preview.getOrbit().yaw).toBeCloseTo(Math.PI/2);
    preview.hide(); expect(canvas.captures.size).toBe(0);
    pointer('pointermove',50); expect(preview.getOrbit().yaw).toBeCloseTo(Math.PI/2);
    preview.resetView(); expect(preview.getOrbit()).toEqual({yaw:0,pitch:0});
    pointer('pointerdown',0); pointer('pointercancel',0); pointer('pointermove',25);
    expect(preview.getOrbit().yaw).toBe(0);
    pointer('pointerdown',0); preview.dispose();
    pointer('pointermove',25); expect(preview.getOrbit().yaw).toBe(0); expect(canvas.captures.size).toBe(0);
  });
});
