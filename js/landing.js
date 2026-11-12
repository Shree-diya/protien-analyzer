(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  let scene = null;
  let camera = null;
  let renderer = null;
  let rootGroup = null;
  let helixGroup = null;
  let helixGroup2 = null;
  let particles = null;
  let animId = null;
  let running = false;
  let containerEl = null;
  let mouseX = 0;
  let mouseY = 0;

  function isThreeAvailable() {
    return typeof global.THREE !== 'undefined';
  }

  function buildHelixMesh(THREE, turns, pointsPerTurn, radius, pitch, colors) {
    const group = new THREE.Group();
    const total = turns * pointsPerTurn;
    const sphereGeo = new THREE.SphereGeometry(0.42, 14, 12);
    const cylGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 8, 1);
    const bondMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.55,
      roughness: 0.4,
      metalness: 0.2
    });

    const pts = [];
    for (let i = 0; i < total; i++) {
      const t = (i / pointsPerTurn) * Math.PI * 2;
      const y = (i - total * 0.5) * pitch;
      const x = Math.cos(t) * radius;
      const z = Math.sin(t) * radius;
      const pos = new THREE.Vector3(x, y, z);
      pts.push(pos);

      const colHex = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color: colHex,
        emissive: colHex,
        emissiveIntensity: 0.22,
        roughness: 0.3,
        metalness: 0.15
      });
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.copy(pos);
      const scale = 0.8 + Math.sin(i * 0.7) * 0.22;
      sphere.scale.setScalar(scale);
      group.add(sphere);

      // Side-chain stub outward
      if (i % 2 === 0) {
        const outDir = new THREE.Vector3(x, 0, z).normalize();
        const sidePos = pos.clone().addScaledVector(outDir, 0.95);
        const sideSphere = new THREE.Mesh(sphereGeo, mat);
        sideSphere.position.copy(sidePos);
        sideSphere.scale.setScalar(0.55);
        group.add(sideSphere);

        const midSide = pos.clone().add(sidePos).multiplyScalar(0.5);
        const sideBond = new THREE.Mesh(cylGeo, bondMat);
        sideBond.position.copy(midSide);
        sideBond.scale.set(0.8, pos.distanceTo(sidePos), 0.8);
        sideBond.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          sidePos.clone().sub(pos).normalize()
        );
        group.add(sideBond);
      }

      // Backbone bond
      if (i > 0) {
        const prev = pts[i - 1];
        const mid = prev.clone().add(pos).multiplyScalar(0.5);
        const bond = new THREE.Mesh(cylGeo, bondMat);
        bond.position.copy(mid);
        bond.scale.set(1, prev.distanceTo(pos), 1);
        bond.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          pos.clone().sub(prev).normalize()
        );
        group.add(bond);
      }
    }

    return group;
  }

  function init(canvasContainer) {
    if (scene) return true;
    if (!isThreeAvailable() || !canvasContainer) return false;
    containerEl = canvasContainer;

    try {
      const THREE = global.THREE;
      const w = canvasContainer.clientWidth || global.innerWidth;
      const h = canvasContainer.clientHeight || global.innerHeight;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 200);
      camera.position.set(0, 0, 26);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.setClearColor(0x000000, 0);

      canvasContainer.innerHTML = '';
      canvasContainer.appendChild(renderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambient);

      const light1 = new THREE.PointLight(0xa855f7, 2.2, 60);
      light1.position.set(14, 12, 16);
      scene.add(light1);

      const light2 = new THREE.PointLight(0x38bdf8, 2.0, 60);
      light2.position.set(-14, -10, 14);
      scene.add(light2);

      rootGroup = new THREE.Group();
      scene.add(rootGroup);

      // Primary floating polypeptide helix on the right
      helixGroup = buildHelixMesh(THREE, 4.5, 11, 3.1, 0.48, [
        0xa855f7, 0x38bdf8, 0xec4899, 0x10b981, 0xf59e0b
      ]);
      helixGroup.position.set(9.5, 0.5, -2);
      helixGroup.rotation.set(0.35, 0.2, -0.45);
      rootGroup.add(helixGroup);

      // Secondary distant structural coil in upper-left background
      helixGroup2 = buildHelixMesh(THREE, 3, 10, 2.2, 0.44, [
        0x38bdf8, 0x8b5cf6, 0x06b6d4, 0xec4899
      ]);
      helixGroup2.position.set(-16.5, 5.5, -14);
      helixGroup2.rotation.set(-0.4, 0.5, 0.65);
      helixGroup2.scale.setScalar(0.68);
      rootGroup.add(helixGroup2);

      // Ambient floating molecular particles
      const pCount = 260;
      const pPos = new Float32Array(pCount * 3);
      const pCol = new Float32Array(pCount * 3);
      const palette = [
        new THREE.Color(0x8b5cf6),
        new THREE.Color(0x38bdf8),
        new THREE.Color(0xec4899),
        new THREE.Color(0x10b981)
      ];

      for (let i = 0; i < pCount; i++) {
        pPos[i * 3] = (Math.random() - 0.5) * 48;
        pPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
        pPos[i * 3 + 2] = (Math.random() - 0.5) * 24 - 4;
        const c = palette[i % palette.length];
        pCol[i * 3] = c.r;
        pCol[i * 3 + 1] = c.g;
        pCol[i * 3 + 2] = c.b;
      }

      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
      pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
      const pMat = new THREE.PointsMaterial({
        size: 0.22,
        vertexColors: true,
        transparent: true,
        opacity: 0.72
      });
      particles = new THREE.Points(pGeo, pMat);
      rootGroup.add(particles);

      global.addEventListener('resize', handleResize);
      global.addEventListener('mousemove', function (e) {
        mouseX = (e.clientX / Math.max(1, global.innerWidth) - 0.5) * 2;
        mouseY = (e.clientY / Math.max(1, global.innerHeight) - 0.5) * 2;
      });

      return true;
    } catch (_err) {
      return false;
    }
  }

  function handleResize() {
    if (!renderer || !camera || !containerEl) return;
    const w = containerEl.clientWidth || global.innerWidth;
    const h = containerEl.clientHeight || global.innerHeight;
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function animate(time) {
    if (!running) return;
    const t = (time || 0) * 0.001;

    if (helixGroup) {
      helixGroup.rotation.y = t * 0.28;
      helixGroup.position.y = 0.5 + Math.sin(t * 0.75) * 0.85;
    }
    if (helixGroup2) {
      helixGroup2.rotation.y = -t * 0.22;
      helixGroup2.position.y = -2.5 + Math.cos(t * 0.6) * 0.75;
    }
    if (particles) {
      particles.rotation.y = t * 0.03;
      particles.rotation.x = Math.sin(t * 0.15) * 0.06;
    }
    if (rootGroup) {
      rootGroup.rotation.y += (mouseX * 0.12 - rootGroup.rotation.y) * 0.03;
      rootGroup.rotation.x += (-mouseY * 0.08 - rootGroup.rotation.x) * 0.03;
    }

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }

    animId = global.requestAnimationFrame(animate);
  }

  function start(canvasContainer) {
    if (running) return;
    if (!scene && !init(canvasContainer)) return;
    handleResize();
    running = true;
    animId = global.requestAnimationFrame(animate);
  }

  function stop() {
    running = false;
    if (animId !== null) {
      global.cancelAnimationFrame(animId);
      animId = null;
    }
  }

  NS.LandingScene = {
    start: start,
    stop: stop
  };
})(window);
