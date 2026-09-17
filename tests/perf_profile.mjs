/**
 * PERFORMANCE BASELINE / PROFILE HARNESS
 *
 * Captures renderer.info and world-structure metrics from the real game via
 * puppeteer. Renderer.info (draw calls, triangles, geometries, textures,
 * programs) is deterministic structural data and comparable before/after.
 *
 * NOTE: this runs under SwiftShader (software GL), so FPS here is NOT
 * representative of real GPU performance and is not reported as such.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'C:\\Users\\lin4s\\Documents\\TRACKRUN\\.perf';
fs.mkdirSync(OUT, { recursive: true });
const LABEL = process.argv[2] || 'baseline';

const browser = await puppeteer.launch({
  executablePath: EDGE_PATH,
  headless: 'new',
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security',
    '--window-size=1600,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'
  ]
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-showcase-enter', { timeout: 40000 });
  await page.click('#btn-showcase-enter');
  await page.waitForFunction(() => {
    const b = document.querySelector('#btn-enter-track');
    return b && !b.disabled;
  }, { timeout: 60000 });
  await page.click('#btn-enter-track');
  await page.waitForFunction(
    () => window.game && window.game.stateMachine && window.game.stateMachine.is('PLAYING'),
    { timeout: 60000 }
  );

  // Let assets + world settle
  await new Promise((r) => setTimeout(r, 3500));

  const metrics = await page.evaluate(async () => {
    const game = window.game;
    const env = game.environment;
    const renderer = env.renderer;
    const scene = env.scene;

    // ---- Static world structure ------------------------------------------
    let meshes = 0, instanced = 0, instances = 0, lines = 0, points = 0, groups = 0;
    let visibleMeshes = 0;
    const materials = new Set();
    const geometries = new Set();
    let noFrustumCulled = 0;
    let matrixAutoUpdateOn = 0;
    const materialList = [];

    scene.traverse((o) => {
      if (o.isInstancedMesh) { instanced++; instances += o.count; }
      else if (o.isMesh) meshes++;
      else if (o.isLineSegments || o.isLine) lines++;
      else if (o.isPoints) points++;
      else if (o.isGroup) groups++;

      if (o.isMesh || o.isLineSegments || o.isPoints) {
        if (o.visible) visibleMeshes++;
        if (o.frustumCulled === false) noFrustumCulled++;
        if (o.matrixAutoUpdate) matrixAutoUpdateOn++;
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => { materials.add(x); materialList.push(x); });
        else if (m) { materials.add(m); materialList.push(m); }
        if (o.geometry) geometries.add(o.geometry);
      }
    });

    // Material type histogram + transparency/emissive cost indicators
    const matTypes = {};
    let transparent = 0, emissiveMats = 0, doubleSided = 0;
    for (const m of materials) {
      const t = m.type || 'unknown';
      matTypes[t] = (matTypes[t] || 0) + 1;
      if (m.transparent) transparent++;
      if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.001) emissiveMats++;
      if (m.side === 2) doubleSided++;
    }

    // Textures
    const textures = new Set();
    for (const m of materials) {
      for (const k of ['map', 'bumpMap', 'roughnessMap', 'normalMap', 'emissiveMap', 'alphaMap']) {
        if (m[k]) textures.add(m[k]);
      }
    }

    // ---- Renderer info ---------------------------------------------------
    // renderer.info resets on every render(), so reading it after
    // composer.render() only reports the final fullscreen pass. Measure the
    // SCENE pass in isolation, plus each post pass individually.
    const pp2 = env.postProcessing;
    const composer = pp2.composer;
    const allPasses = composer.passes;

    const scenePassCalls = [];
    const perPass = [];

    const savedEnabled = allPasses.map((p) => p.enabled !== false);

    // 1. Scene-only render (RenderPass alone) = true world draw cost
    for (let i = 0; i < 3; i++) {
      allPasses.forEach((p, idx) => { p.enabled = idx === 0; });
      renderer.info.reset();
      composer.render();
      scenePassCalls.push({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        lines: renderer.info.render.lines
      });
    }

    // 2. Each pass measured cumulatively (pass N enabled with 0..N-1)
    for (let n = 1; n < allPasses.length; n++) {
      allPasses.forEach((p, idx) => { p.enabled = idx <= n; });
      renderer.info.reset();
      const t0 = performance.now();
      composer.render();
      // Force GPU sync point by reading a pixel-ish metric is not available;
      // use wall time over a few frames instead.
      perPass.push({
        upTo: allPasses[n].constructor ? allPasses[n].constructor.name : `pass${n}`,
        calls: renderer.info.render.calls
      });
    }

    // restore
    allPasses.forEach((p, idx) => { p.enabled = savedEnabled[idx]; });
    composer.render();

    const maxScene = (k) => Math.max(...scenePassCalls.map((s) => s[k]));

    const last = {
      programs: renderer.info.programs ? renderer.info.programs.length : -1,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures
    };

    // Post-processing pass inventory
    const pp = env.postProcessing;
    const passes = allPasses.map((p) => ({
      name: p.constructor ? p.constructor.name : 'unknown',
      enabled: p.enabled !== false
    }));

    return {
      renderer: {
        sceneDrawCalls: maxScene('calls'),
        sceneTriangles: maxScene('triangles'),
        sceneLines: maxScene('lines'),
        programs: last.programs,
        geometriesInMemory: last.geometries,
        texturesInMemory: last.textures,
        perPassCumulative: perPass
      },
      renderTargets: {
        pixelRatio: renderer.getPixelRatio(),
        devicePixelRatio: window.devicePixelRatio,
        drawingBufferSize: [renderer.domElement.width, renderer.domElement.height],
        cssSize: [renderer.domElement.clientWidth, renderer.domElement.clientHeight]
      },
      world: {
        meshes, instancedMeshes: instanced, totalInstances: instances,
        lines, points, groups,
        visibleMeshes,
        uniqueMaterials: materials.size,
        uniqueGeometries: geometries.size,
        uniqueTextures: textures.size,
        frustumCullingDisabled: noFrustumCulled,
        matrixAutoUpdateOn,
        transparentMaterials: transparent,
        emissiveMaterials: emissiveMats,
        doubleSidedMaterials: doubleSided,
        materialTypes: matTypes
      },
      postprocessing: {
        passes,
        exposure: renderer.toneMappingExposure,
        bloomEnabled: pp && pp.bloomPass ? pp.bloomPass.enabled : null,
        bloomStrength: pp && pp.bloomPass ? pp.bloomPass.strength : null
      },
      quality: {
        visualQuality: game.environment.postProcessing.qualityMode,
        viewmodelMode: 'n/a'
      },
      audio: {
        sectionTheme: game.world.visualController.state.sectionTheme,
        reactivity: game.world.visualController.state.reactivityMultiplier
      }
    };
  });

  console.log('\n================ PERF PROFILE (' + LABEL + ') ================');
  console.log(JSON.stringify(metrics, null, 2));

  await page.screenshot({ path: path.join(OUT, `${LABEL}.png`) });
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(metrics, null, 2));
  console.log(`\nSaved to .perf/${LABEL}.json`);
} finally {
  await browser.close();
}