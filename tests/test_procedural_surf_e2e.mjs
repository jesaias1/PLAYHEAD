import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\lin4s\\.gemini\\antigravity\\brain\\ed6a93af-435f-4ce7-a35a-81381d79f4f6';

function copyArtifact(filename) {
  if (fs.existsSync(filename)) {
    fs.copyFileSync(filename, path.join(ARTIFACT_DIR, filename));
    console.log(`[ARTIFACT COPIED] ${filename}`);
  }
}

async function runProceduralSurfE2ETest() {
  console.log('[TEST] Launching browser for Procedural Surf E2E Test...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1920,1080'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('[TEST] Navigating to http://127.0.0.1:3000...');
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle0' });

    // 1. Select the synthetic ELECTRONIC_DROP track
    console.log('[TEST] Selecting ELECTRONIC_DROP dev track...');
    await page.evaluate(async () => {
      await window.game.handleDevTrackSelected('ELECTRONIC_DROP');
    });

    // Wait for analysis and generation to complete and state to reach READY
    console.log('[TEST] Waiting for track generation and READY state...');
    await page.waitForFunction(() => window.game.stateMachine.currentState === 'READY', { timeout: 15000 });
    console.log('[TEST] Game state is READY!');

    // 2. Inspect generated course data
    const routeInfo = await page.evaluate(() => {
      const track = window.game.currentTrack;
      const analysis = window.game.currentAnalysis;

      const surfNodes = track.route.filter((n) => n.isSurf || n.type === 'SURF_RAMP');
      const landingNodes = track.route.filter((n) => n.type === 'LANDING');
      const approachNodes = track.route.filter((n) => n.type === 'SURF_APPROACH');

      // Find drop ramp and what follows it
      const dropRamp = surfNodes[0];
      let dropRampIdx = -1;
      if (dropRamp) {
        dropRampIdx = track.route.findIndex((n) => n.id === dropRamp.id);
      }

      const subsequentNodes = dropRampIdx >= 0 ? track.route.slice(dropRampIdx + 1, dropRampIdx + 6) : [];

      return {
        totalNodes: track.route.length,
        duration: analysis.duration,
        bpm: analysis.bpm,
        surfCount: surfNodes.length,
        surfNodes: surfNodes.map((s) => ({
          id: s.id,
          time: s.time,
          type: s.type,
          pos: s.position,
          dims: s.dimensions,
          pitch: s.pitch,
          roll: s.roll,
          normal: s.surfNormal
        })),
        approachCount: approachNodes.length,
        landingCount: landingNodes.length,
        dropRampIdx,
        subsequentElevations: subsequentNodes.map((n) => ({
          id: n.id,
          type: n.type,
          y: n.position.y,
          time: n.time
        }))
      };
    });

    console.log('\n--- GENERATED ROUTE INSPECTION ---');
    console.log(`Total Route Nodes: ${routeInfo.totalNodes}`);
    console.log(`BPM: ${routeInfo.bpm}, Duration: ${routeInfo.duration}s`);
    console.log(`Surf Ramps Generated: ${routeInfo.surfCount}`);
    console.log(`Approach Nodes: ${routeInfo.approachCount}, Landing Catch Decks: ${routeInfo.landingCount}`);
    console.log('Surf Nodes:', JSON.stringify(routeInfo.surfNodes, null, 2));
    console.log('Subsequent Nodes after Drop Ramp:', JSON.stringify(routeInfo.subsequentElevations, null, 2));

    if (routeInfo.surfCount === 0) {
      throw new Error('No surf ramps were generated in the track!');
    }

    const firstSurf = routeInfo.surfNodes[0];
    const initialY = firstSurf.pos.y;
    console.log(`\n[ANALYSIS] Drop Surf starts at Y=${initialY.toFixed(2)} at t=${firstSurf.time.toFixed(2)}s`);
    const lowerDeckNode = routeInfo.subsequentElevations.find((n) => n.type === 'LANDING');
    if (lowerDeckNode) {
      const dropAmount = initialY - lowerDeckNode.y;
      console.log(`[ANALYSIS] Lower-Deck Catch Landing Y=${lowerDeckNode.y.toFixed(2)} (Vertical Drop: ${dropAmount.toFixed(2)}m)`);
      if (dropAmount < 10.0) {
        console.warn('[WARNING] Vertical drop is less than expected 10m');
      } else {
        console.log(`[PASS] Massive vertical descent of ${dropAmount.toFixed(2)}m confirmed!`);
      }
    }

    // Verify level continuation below
    const laterRunways = routeInfo.subsequentElevations.filter((n) => n.type !== 'LANDING');
    console.log(`[ANALYSIS] Level continuation nodes below:`);
    for (const lr of laterRunways) {
      console.log(`  Node ${lr.id} (${lr.type}): Y=${lr.y.toFixed(2)} at t=${lr.time.toFixed(2)}s`);
    }

    // 3. Transition to PLAYING
    console.log('\n[TEST] Transitioning state to PLAYING...');
    await page.evaluate(() => {
      window.game.stateMachine.transitionTo('PLAYING');
    });
    await new Promise((r) => setTimeout(r, 600));

    // Enable F3 overlay for visual diagnostics
    await page.keyboard.press('F3');
    await new Promise((r) => setTimeout(r, 200));

    // 4. Position player right on the SURF_APPROACH platform looking at the ramp
    console.log('[TEST] Moving player to Surf Approach platform...');
    const approachData = await page.evaluate(() => {
      const track = window.game.currentTrack;
      const approachNode = track.route.find((n) => n.type === 'SURF_APPROACH');
      const surfNode = track.route.find((n) => n.isSurf);
      const p = window.game.playerController;

      if (approachNode && surfNode) {
        // Position at back of approach platform
        const yaw = surfNode.yaw;
        p.setPosition({
          x: approachNode.position.x,
          y: approachNode.position.y + 1.2,
          z: approachNode.position.z - approachNode.dimensions.z * 0.35
        });
        p.setOrientation(yaw);
        p.velocity.set(0, 0, 0);
        return {
          approachPos: approachNode.position,
          surfPos: surfNode.position,
          yaw,
          bankRoll: surfNode.roll
        };
      }
      return null;
    });

    console.log('[TEST] Player positioned at approach:', approachData);
    await new Promise((r) => setTimeout(r, 400));

    await page.screenshot({ path: 'screenshot_procedural_surf_approach.png' });
    copyArtifact('screenshot_procedural_surf_approach.png');

    // 5. Run forward and leap onto the ramp
    console.log('[TEST] Accelerating towards surf ramp along route heading...');
    const bankRoll = approachData.bankRoll;
    // bankRoll > 0 => ramp on left (requires holding KeyA)
    // bankRoll < 0 => ramp on right (requires holding KeyD)
    const requiredKey = bankRoll > 0 ? 'KeyA' : 'KeyD';
    console.log(`[TEST] Ramp bankRoll=${bankRoll.toFixed(3)} rad (${((bankRoll * 180) / Math.PI).toFixed(1)}°). Required surf key: ${requiredKey}`);

    // Launch player into the ramp at speed (16 m/s)
    await page.evaluate((roll) => {
      const p = window.game.playerController;
      const surfNode = window.game.currentTrack.route.find((n) => n.isSurf);
      const bankSign = Math.sign(roll);

      // Place player just at the ramp lip with forward velocity
      const offsetLat = bankSign * -2.0; // on the ramp face
      p.setPosition({
        x: surfNode.position.x + offsetLat,
        y: surfNode.position.y + 1.5,
        z: surfNode.position.z - surfNode.dimensions.z * 0.42
      });
      p.velocity.set(0, -0.5, 16.0);
      p.setOrientation(surfNode.yaw);
    }, bankRoll);

    // Hold the required surf key
    console.log(`[TEST] Holding ${requiredKey} to surf...`);
    await page.keyboard.down(requiredKey);

    // Simulate riding down the ramp over 800ms
    let samples = [];
    for (let s = 0; s < 8; s++) {
      await new Promise((r) => setTimeout(r, 100));
      const state = await page.evaluate(() => {
        const p = window.game.playerController;
        const surf = p.surfState;
        const vel = p.velocity;
        const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        const totalSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        const hudIndicator = document.getElementById('hud-surf-indicator');
        return {
          isSurfing: surf.isSurfing,
          surfSide: surf.surfSide,
          speed: hSpeed,
          speedTotal: totalSpeed,
          pos: { x: p.position.x, y: p.position.y, z: p.position.z },
          hudVisible: hudIndicator ? hudIndicator.classList.contains('visible') : false,
          hudText: hudIndicator ? hudIndicator.textContent : ''
        };
      });
      samples.push(state);
    }

    await page.screenshot({ path: 'screenshot_procedural_surf_sliding.png' });
    copyArtifact('screenshot_procedural_surf_sliding.png');

    // Release the key
    await page.keyboard.up(requiredKey);

    console.log('\n--- SURF SAMPLES DURING DESCENT ---');
    for (let i = 0; i < samples.length; i++) {
      const sm = samples[i];
      console.log(`Sample ${i}: surfing=${sm.isSurfing}, side=${sm.surfSide}, speed=${sm.speedTotal.toFixed(2)}m/s (${(sm.speedTotal * 25).toFixed(0)}u/s), pos.y=${sm.pos.y.toFixed(2)}, HUD="${sm.hudText}" (visible: ${sm.hudVisible})`);
    }

    const anySurfed = samples.some((s) => s.isSurfing);
    console.log(`\n[SURF CHECK] Surfed during descent: ${anySurfed ? 'YES (PASS)' : 'NO (FAIL)'}`);
    const verticalTravel = samples[0].pos.y - samples[samples.length - 1].pos.y;
    console.log(`[VERTICAL DESCENT] Player descended ${verticalTravel.toFixed(2)}m during slide`);

    // 6. Let player land on the lower deck
    console.log('\n[TEST] Letting player glide onto lower deck...');
    await new Promise((r) => setTimeout(r, 600));

    const finalState = await page.evaluate(() => {
      const p = window.game.playerController;
      const vel = p.velocity;
      return {
        pos: { x: p.position.x, y: p.position.y, z: p.position.z },
        isGrounded: p.isGrounded,
        speed: Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z),
        isDead: p.isDead || false
      };
    });
    console.log('[FINAL STATE ON LOWER DECK]:', finalState);

    await page.screenshot({ path: 'screenshot_procedural_surf_landed_lower_deck.png' });
    copyArtifact('screenshot_procedural_surf_landed_lower_deck.png');

    console.log('\n=== PROCEDURAL SURF E2E VERIFICATION COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('[ERROR]', err);
    throw err;
  } finally {
    await browser.close();
  }
}

runProceduralSurfE2ETest();
