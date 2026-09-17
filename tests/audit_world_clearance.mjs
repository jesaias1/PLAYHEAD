import * as THREE from "three";
import { TrackGenerator } from "../src/generation/TrackGenerator.ts";
import { GeometryBuilder } from "../src/world/GeometryBuilder.ts";
import { SkylineArchitecture } from "../src/world/SkylineArchitecture.ts";
import { SpectralArchitecture } from "../src/world/SpectralArchitecture.ts";
import { DropSetpiece } from "../src/world/DropSetpiece.ts";
import { CelestialLandmarks } from "../src/world/CelestialLandmarks.ts";
import { RouteExclusionCorridor } from "../src/world/RouteExclusionCorridor.ts";
import { PaletteSelector } from "../src/audio/TrackPalettes.ts";

function stub(seed){
  const frames=[]; for(let i=0;i<1200;i++) frames.push({time:i*0.05,rms:0.35,bass:0.4,lowMid:0.35,mid:0.3,high:0.3,centroid:0.5,flux:0.2});
  const sections=[]; const th=["FLOW","BUILDUP","DROP","SURF","ASCENT","PRECISION","SPEED","FLOW"];
  for(let i=0;i<8;i++) sections.push({index:i,start:i*7.5,end:(i+1)*7.5,duration:7.5,intensity:0.5,rhythmicDensity:0.5,brightness:0.5,theme:th[i]});
  return {seed,duration:60,globalEnergy:0.6,frames,sections,onsets:[],waveform:new Array(1024).fill(0.3),
    visualAccent:{name:"T",hex:"#a855f7",rgb:[168,85,247]}};
}

let totalViol=0, checkedSeeds=0;
console.log("=== POST-SAFETY-PASS CLEARANCE (using real evaluateVolume) ===");
for (const seed of [12345,777,4242,99991,31337,555,8080,1234]) {
  const a=stub(seed); const pal=PaletteSelector.selectPalette(seed,0.5,0.6);
  const track=TrackGenerator.generate(a,pal); const scene=new THREE.Scene();
  const built=GeometryBuilder.buildWorld(track,pal);
  const sky=new SkylineArchitecture(scene,a,track);
  const spec=new SpectralArchitecture(scene,a,track);
  const drop=new DropSetpiece(scene,a,track);
  const cel=new CelestialLandmarks(scene,a,track,pal);

  const nodes=[...track.route,...(track.optionalRamps||[]),...(track.recoveryShelves||[])];
  const corridor=new RouteExclusionCorridor(nodes);

  // simulate what World does
  const roots=[drop.group,spec.group,sky.group];
  if(cel.group) roots.push(cel.group);
  if(built.decorativeGroup) roots.push(built.decorativeGroup);
  const report=corridor.validateDecorations(roots);

  // Re-scan everything that SURVIVED for residual violations
  let residual=0, worst=0;
  for (const root of roots) {
    root.updateWorldMatrix(true,true);
    root.traverse(o=>{
      if(o.isInstancedMesh){
        const gb=o.geometry.boundingBox||(o.geometry.computeBoundingBox(),o.geometry.boundingBox);
        const m=new THREE.Matrix4(), b=new THREE.Box3();
        for(let j=0;j<o.count;j++){o.getMatrixAt(j,m); b.copy(gb).applyMatrix4(m).applyMatrix4(o.matrixWorld);
          const h=corridor.evaluateVolume(b,28.0); if(h){residual++; worst=Math.max(worst,h.penetration);} }
      } else if(o.isMesh && o.parent){
        const b=new THREE.Box3().setFromObject(o);
        if(b.isEmpty())return;
        const h=corridor.evaluateVolume(b,28.0); if(h){residual++; worst=Math.max(worst,h.penetration);}
      }
    });
  }
  totalViol+=residual; checkedSeeds++;
  console.log(`seed=${String(seed).padStart(6)} nodes=${String(nodes.length).padStart(3)} rejected=${String(report.total).padStart(3)} residualViolations=${residual} worst=${worst.toFixed(1)}m`);
}
console.log(`\nTOTAL residual violations after final safety pass: ${totalViol}`);