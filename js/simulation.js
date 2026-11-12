(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let sphereMesh = null;
  let bondMesh = null;
  let bondLines = null;
  let tipMarker = null;
  let resizeObserver = null;
  let animFrameId = null;

  const simState = {
    initialized: false,
    webglFailed: false,
    sequence: '',
    modelKey: 'sideChain',
    positions: null,
    totalResidues: 0,
    visibleCount: 0,
    isPlaying: false,
    speed: 1.0, // multiplier
    lastTimestamp: 0,
    accumulator: 0,
    hasRevealedOnce: false,
    onCompleteCallback: null,
    onProgressCallback: null,
    center: null,
    boundingRadius: 10
  };

  function isThreeAvailable() {
    return typeof global.THREE !== 'undefined';
  }

  /**
   * Generates a smooth, deterministic 3D polypeptide-like coil path.
   * Bond step is constant (~1.8 units), with gentle helical + deterministic drift
   * so long chains form a readable 3D macromolecular coil rather than a straight line.
   */
  function generateChainPositions(sequence) {
    const n = sequence.length;
    const positions = new Float32Array(n * 3);
    if (n === 0) return positions;

    const step = 1.65;
    let x = 0;
    let y = 0;
    let z = 0;

    // Direction angles
    let yaw = 0;
    let pitch = 0;

    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;

    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;

    for (let i = 1; i < n; i++) {
      const code = sequence.charCodeAt(i);
      // Deterministic pseudo-torsion perturbation based on residue + index
      const hash = ((code * 31 + i * 17) % 100) / 100 - 0.5;
      yaw += 0.42 + hash * 0.35;
      pitch = Math.sin(i * 0.13) * 0.55 + Math.cos(i * 0.037) * 0.35;

      const cp = Math.cos(pitch);
      const dx = Math.cos(yaw) * cp * step;
      const dy = Math.sin(pitch) * step + 0.12;
      const dz = Math.sin(yaw) * cp * step;

      x += dx;
      y += dy;
      z += dz;

      // Gentle global drift back toward a bounded volume for ultra-long chains
      if (n > 500) {
        const pull = 0.0035;
        x -= x * pull;
        y -= y * pull * 0.5;
        z -= z * pull;
      }

      const idx = i * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    const radius = Math.max(8, Math.sqrt(spanX * spanX + spanY * spanY + spanZ * spanZ) * 0.55);

    simState.center = { x: cx, y: cy, z: cz };
    simState.boundingRadius = radius;

    return positions;
  }

  function clearMeshes() {
    if (!scene) return;
    if (sphereMesh) {
      scene.remove(sphereMesh);
      sphereMesh.geometry.dispose();
      sphereMesh.material.dispose();
      sphereMesh = null;
    }
    if (bondMesh) {
      scene.remove(bondMesh);
      bondMesh.geometry.dispose();
      bondMesh.material.dispose();
      bondMesh = null;
    }
    if (bondLines) {
      scene.remove(bondLines);
      bondLines.geometry.dispose();
      bondLines.material.dispose();
      bondLines = null;
    }
    if (tipMarker) {
      scene.remove(tipMarker);
      tipMarker.geometry.dispose();
      tipMarker.material.dispose();
      tipMarker = null;
    }
  }

  function initScene(container) {
    if (simState.initialized) return true;
    if (!isThreeAvailable() || !container) {
      simState.webglFailed = true;
      return false;
    }

    try {
      const THREE = global.THREE;
      const width = container.clientWidth || 640;
      const height = container.clientHeight || 360;

      scene = new THREE.Scene();
      updateSceneBackground();

      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
      camera.position.set(0, 12, 34);

      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);

      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambient);

      const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.75);
      dirLight1.position.set(25, 45, 35);
      scene.add(dirLight1);

      const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.35);
      dirLight2.position.set(-25, -20, -30);
      scene.add(dirLight2);

      if (typeof THREE.OrbitControls === 'function') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
      }

      if (typeof global.ResizeObserver === 'function') {
        resizeObserver = new global.ResizeObserver(function () {
          resizeRenderer(container);
        });
        resizeObserver.observe(container);
      } else {
        global.addEventListener('resize', function () {
          resizeRenderer(container);
        });
      }

      simState.initialized = true;
      startRenderLoop();
      return true;
    } catch (_err) {
      simState.webglFailed = true;
      return false;
    }
  }

  function updateSceneBackground() {
    if (!scene || !isThreeAvailable()) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    scene.background = new global.THREE.Color(isLight ? 0xf1f5f9 : 0x060913);
  }

  function resizeRenderer(container) {
    if (!renderer || !camera || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function fitCamera() {
    if (!camera || !simState.center) return;
    const c = simState.center;
    const r = simState.boundingRadius;
    const dist = Math.max(20, r * 2.35);
    camera.position.set(c.x + dist * 0.52, c.y + dist * 0.28, c.z + dist * 0.85);
    camera.near = Math.max(0.1, dist * 0.002);
    camera.far = Math.max(2000, dist * 12);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(c.x, c.y, c.z);
      controls.update();
    } else {
      camera.lookAt(c.x, c.y, c.z);
    }
  }

  function buildGeometryForSequence(sequence, modelKey) {
    if (!scene || !isThreeAvailable()) return;
    const THREE = global.THREE;
    clearMeshes();

    const n = sequence.length;
    const positions = generateChainPositions(sequence);
    simState.positions = positions;
    simState.totalResidues = n;
    simState.sequence = sequence;
    simState.modelKey = modelKey;

    const isLong = n > 1000;
    const sphereDetail = isLong ? [7, 5] : [14, 10];
    const sphereRadius = isLong ? 0.52 : 0.62;

    const sphereGeo = new THREE.SphereGeometry(sphereRadius, sphereDetail[0], sphereDetail[1]);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.08
    });

    sphereMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, n);
    sphereMesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const idx = i * 3;
      dummy.position.set(positions[idx], positions[idx + 1], positions[idx + 2]);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      sphereMesh.setMatrixAt(i, dummy.matrix);
    }
    sphereMesh.instanceMatrix.needsUpdate = true;
    applyGroupColors(modelKey);
    sphereMesh.count = 0;
    scene.add(sphereMesh);

    // Peptide bonds
    if (n > 1) {
      if (isLong) {
        // Ultra-fast 1-draw-call LineSegments for >1,000 residues
        const linePositions = new Float32Array((n - 1) * 6);
        for (let i = 0; i < n - 1; i++) {
          const a = i * 3;
          const b = (i + 1) * 3;
          const o = i * 6;
          linePositions[o] = positions[a];
          linePositions[o + 1] = positions[a + 1];
          linePositions[o + 2] = positions[a + 2];
          linePositions[o + 3] = positions[b];
          linePositions[o + 4] = positions[b + 1];
          linePositions[o + 5] = positions[b + 2];
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        lineGeo.setDrawRange(0, 0);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x94a3b8,
          transparent: true,
          opacity: 0.8
        });
        bondLines = new THREE.LineSegments(lineGeo, lineMat);
        bondLines.frustumCulled = false;
        scene.add(bondLines);
      } else {
        // Instanced cylinder bonds for <=1,000 residues
        const cylGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 8, 1);
        const cylMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.55,
          metalness: 0.1
        });
        bondMesh = new THREE.InstancedMesh(cylGeo, cylMat, n - 1);
        bondMesh.frustumCulled = false;

        const up = new THREE.Vector3(0, 1, 0);
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const dir = new THREE.Vector3();
        const mid = new THREE.Vector3();
        const quat = new THREE.Quaternion();

        for (let i = 0; i < n - 1; i++) {
          const a = i * 3;
          const b = (i + 1) * 3;
          pA.set(positions[a], positions[a + 1], positions[a + 2]);
          pB.set(positions[b], positions[b + 1], positions[b + 2]);
          dir.subVectors(pB, pA);
          const len = dir.length() || 0.001;
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          quat.setFromUnitVectors(up, dir.clone().normalize());

          dummy.position.copy(mid);
          dummy.quaternion.copy(quat);
          dummy.scale.set(1, len, 1);
          dummy.updateMatrix();
          bondMesh.setMatrixAt(i, dummy.matrix);
        }
        bondMesh.instanceMatrix.needsUpdate = true;
        bondMesh.count = 0;
        scene.add(bondMesh);
      }
    }

    // Active nascent-tip highlight sphere (translation elongation site)
    const tipGeo = new THREE.SphereGeometry(isLong ? 0.95 : 1.05, 14, 10);
    const tipMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      wireframe: true
    });
    tipMarker = new THREE.Mesh(tipGeo, tipMat);
    tipMarker.visible = false;
    scene.add(tipMarker);

    fitCamera();
  }

  function applyGroupColors(modelKey) {
    simState.modelKey = modelKey;
    if (!sphereMesh || !simState.sequence || !isThreeAvailable()) return;
    const THREE = global.THREE;
    const lookup =
      NS.Constants.RESIDUE_GROUP_LOOKUP[modelKey] || NS.Constants.RESIDUE_GROUP_LOOKUP.sideChain;
    const colorCache = {};
    const seq = simState.sequence;
    const n = seq.length;

    for (let i = 0; i < n; i++) {
      const aa = seq[i];
      const grp = lookup[aa];
      const hex = grp ? grp.color : '#64748b';
      let col = colorCache[hex];
      if (!col) {
        col = new THREE.Color(hex);
        colorCache[hex] = col;
      }
      sphereMesh.setColorAt(i, col);
    }
    if (sphereMesh.instanceColor) {
      sphereMesh.instanceColor.needsUpdate = true;
    }
  }

  function setVisibleResidueCount(count) {
    const clamped = Math.max(0, Math.min(simState.totalResidues, Math.floor(count)));
    simState.visibleCount = clamped;

    if (sphereMesh) {
      sphereMesh.count = clamped;
    }
    if (bondMesh) {
      bondMesh.count = Math.max(0, clamped - 1);
    }
    if (bondLines) {
      bondLines.geometry.setDrawRange(0, Math.max(0, clamped - 1) * 2);
    }
    if (tipMarker && simState.positions) {
      if (clamped > 0 && clamped < simState.totalResidues) {
        const idx = (clamped - 1) * 3;
        tipMarker.position.set(
          simState.positions[idx],
          simState.positions[idx + 1],
          simState.positions[idx + 2]
        );
        tipMarker.visible = true;
      } else {
        tipMarker.visible = false;
      }
    }

    const isComplete = clamped >= simState.totalResidues;
    if (isComplete) {
      simState.isPlaying = false;
    }

    if (typeof simState.onProgressCallback === 'function') {
      simState.onProgressCallback({
        visible: clamped,
        total: simState.totalResidues,
        isPlaying: simState.isPlaying,
        isComplete: isComplete
      });
    }

    if (isComplete && !simState.hasRevealedOnce) {
      simState.hasRevealedOnce = true;
      if (typeof simState.onCompleteCallback === 'function') {
        simState.onCompleteCallback();
      }
    }
  }

  function stepAnimation(timestamp) {
    if (!simState.lastTimestamp) simState.lastTimestamp = timestamp;
    const dt = Math.min(0.1, (timestamp - simState.lastTimestamp) / 1000);
    simState.lastTimestamp = timestamp;

    if (simState.isPlaying && simState.totalResidues > 0) {
      const n = simState.totalResidues;
      let rate;
      if (n <= 1000) {
        // Smooth translation-style pace (~25 to 90 residues/sec scaled by sequence length)
        const baseRate = Math.max(18, Math.min(95, n / 2.8));
        rate = baseRate * simState.speed;
      } else {
        // Long chain optimization: animate first 600 residues cleanly, then fast-forward the rest
        if (simState.visibleCount < 600) {
          rate = 180 * simState.speed;
        } else {
          rate = Math.max(4000, (n - 600) / 1.1) * simState.speed;
        }
      }

      simState.accumulator += dt * rate;
      const advance = Math.floor(simState.accumulator);
      if (advance >= 1) {
        simState.accumulator -= advance;
        const nextCount = Math.min(n, simState.visibleCount + advance);
        setVisibleResidueCount(nextCount);
        if (nextCount >= n) {
          simState.isPlaying = false;
        }
      }
    }

    if (controls) controls.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }

    animFrameId = global.requestAnimationFrame(stepAnimation);
  }

  function startRenderLoop() {
    if (animFrameId !== null) return;
    simState.lastTimestamp = 0;
    animFrameId = global.requestAnimationFrame(stepAnimation);
  }

  function loadSequence(container, sequence, modelKey, callbacks) {
    simState.onCompleteCallback = callbacks && callbacks.onComplete ? callbacks.onComplete : null;
    simState.onProgressCallback = callbacks && callbacks.onProgress ? callbacks.onProgress : null;
    simState.hasRevealedOnce = false;
    simState.accumulator = 0;

    const ok = initScene(container);
    if (!ok) {
      // Fallback: cannot render WebGL; immediately mark complete so results never block
      simState.hasRevealedOnce = true;
      if (simState.onCompleteCallback) simState.onCompleteCallback();
      return false;
    }

    resizeRenderer(container);
    buildGeometryForSequence(sequence, modelKey);
    setVisibleResidueCount(1);
    simState.isPlaying = true;
    return true;
  }

  function play() {
    if (simState.totalResidues === 0) return;
    if (simState.visibleCount >= simState.totalResidues) {
      setVisibleResidueCount(1);
    }
    simState.isPlaying = true;
  }

  function pause() {
    simState.isPlaying = false;
    if (typeof simState.onProgressCallback === 'function') {
      simState.onProgressCallback({
        visible: simState.visibleCount,
        total: simState.totalResidues,
        isPlaying: false,
        isComplete: simState.visibleCount >= simState.totalResidues
      });
    }
  }

  function restart() {
    if (simState.totalResidues === 0) return;
    simState.accumulator = 0;
    setVisibleResidueCount(1);
    simState.isPlaying = true;
  }

  function completeNow() {
    if (simState.totalResidues === 0) return;
    simState.isPlaying = false;
    setVisibleResidueCount(simState.totalResidues);
  }

  function scrubTo(count) {
    simState.isPlaying = false;
    setVisibleResidueCount(count);
  }

  function setSpeed(speed) {
    simState.speed = Math.max(0.25, Math.min(8, Number(speed) || 1));
  }

  function resetCamera() {
    fitCamera();
  }

  NS.Simulation = {
    isThreeAvailable: isThreeAvailable,
    loadSequence: loadSequence,
    applyGroupColors: applyGroupColors,
    updateSceneBackground: updateSceneBackground,
    play: play,
    pause: pause,
    restart: restart,
    completeNow: completeNow,
    scrubTo: scrubTo,
    setSpeed: setSpeed,
    resetCamera: resetCamera,
    resize: resizeRenderer,
    getState: function () {
      return {
        visible: simState.visibleCount,
        total: simState.totalResidues,
        isPlaying: simState.isPlaying,
        webglFailed: simState.webglFailed
      };
    }
  };
})(window);
