(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  const THREE_TO_ONE = {
    ALA: 'A',
    CYS: 'C',
    ASP: 'D',
    GLU: 'E',
    PHE: 'F',
    GLY: 'G',
    HIS: 'H',
    ILE: 'I',
    LYS: 'K',
    LEU: 'L',
    MET: 'M',
    ASN: 'N',
    PRO: 'P',
    GLN: 'Q',
    ARG: 'R',
    SER: 'S',
    THR: 'T',
    VAL: 'V',
    TRP: 'W',
    TYR: 'Y'
  };

  const ESMFOLD_MAX_LENGTH = 400;
  const FETCH_TIMEOUT_MS = 30000;

  let viewer = null;
  let currentContainer = null;
  let currentPdbText = null;
  let currentSourceLabel = '';
  let currentStyle = 'cartoon';
  let currentModelKey = 'sideChain';
  let isSpinning = false;
  let activeAbortController = null;

  function is3DmolAvailable() {
    return typeof global.$3Dmol !== 'undefined';
  }

  function getBackgroundHex() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return isLight ? '#f1f5f9' : '#060913';
  }

  function ensureViewer(container) {
    if (!is3DmolAvailable() || !container) return null;
    if (!viewer || currentContainer !== container) {
      container.innerHTML = '';
      viewer = global.$3Dmol.createViewer(container, {
        backgroundColor: getBackgroundHex()
      });
      currentContainer = container;
    }
    return viewer;
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = controller;

    const timer = global.setTimeout(function () {
      controller.abort();
    }, timeoutMs || FETCH_TIMEOUT_MS);

    const opts = Object.assign({}, options || {}, { signal: controller.signal });

    return fetch(url, opts).finally(function () {
      global.clearTimeout(timer);
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    });
  }

  function makeGroupColorFunc(modelKey) {
    const lookup =
      NS.Constants.RESIDUE_GROUP_LOOKUP[modelKey] || NS.Constants.RESIDUE_GROUP_LOOKUP.sideChain;
    return function (atom) {
      const resn = atom && atom.resn ? String(atom.resn).trim().toUpperCase() : '';
      const one = THREE_TO_ONE[resn];
      if (!one) return '#94a3b8';
      const grp = lookup[one];
      return grp ? grp.color : '#94a3b8';
    };
  }

  function applyRepresentation(style, modelKey) {
    currentStyle = style || currentStyle;
    currentModelKey = modelKey || currentModelKey;
    if (!viewer || !currentPdbText) return;

    const colorFn = makeGroupColorFunc(currentModelKey);
    viewer.removeAllSurfaces();
    viewer.setStyle({}, {});

    if (currentStyle === 'stick') {
      viewer.setStyle({}, { stick: { colorfunc: colorFn, radius: 0.2 } });
    } else if (currentStyle === 'surface') {
      viewer.setStyle({}, { cartoon: { colorfunc: colorFn, opacity: 0.75 } });
      viewer.addSurface(global.$3Dmol.SurfaceType.VDW, {
        opacity: 0.82,
        colorfunc: colorFn
      });
    } else {
      viewer.setStyle({}, { cartoon: { colorfunc: colorFn } });
    }

    viewer.render();
  }

  function renderPdb(container, pdbText, sourceLabel, style, modelKey) {
    const v = ensureViewer(container);
    if (!v) {
      throw new Error('3Dmol.js viewer library is not available.');
    }
    currentPdbText = pdbText;
    currentSourceLabel = sourceLabel;
    v.setBackgroundColor(getBackgroundHex());
    v.clear();
    v.removeAllSurfaces();
    v.addModel(pdbText, 'pdb');
    applyRepresentation(style || currentStyle, modelKey || currentModelKey);
    v.zoomTo();
    v.render();
    if (isSpinning) {
      v.spin('y', 0.8);
    }
  }

  async function loadFromPdbId(pdbIdRaw) {
    const id = String(pdbIdRaw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      throw new Error('Enter a valid 4-character PDB ID (e.g. 1UBQ or 1EMA).');
    }
    const url = 'https://files.rcsb.org/download/' + encodeURIComponent(id) + '.pdb';
    const res = await fetchWithTimeout(url, { method: 'GET' }, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      throw new Error('RCSB PDB returned HTTP ' + res.status + ' for "' + id + '".');
    }
    const text = await res.text();
    if (!text || text.indexOf('ATOM') === -1) {
      throw new Error('Downloaded file did not contain valid PDB atomic coordinates.');
    }
    return {
      pdbText: text,
      sourceLabel: 'Experimental (RCSB PDB: ' + id + ')'
    };
  }

  async function loadFromUniProt(accessionRaw) {
    const acc = String(accessionRaw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,10}$/.test(acc)) {
      throw new Error('Enter a valid UniProt accession (e.g. P0CG48 or P42212).');
    }
    const apiUrl = 'https://alphafold.ebi.ac.uk/api/prediction/' + encodeURIComponent(acc);
    const metaRes = await fetchWithTimeout(apiUrl, { method: 'GET' }, FETCH_TIMEOUT_MS);
    if (!metaRes.ok) {
      throw new Error('AlphaFold DB returned HTTP ' + metaRes.status + ' for "' + acc + '".');
    }
    const payload = await metaRes.json();
    if (!Array.isArray(payload) || payload.length === 0 || !payload[0].pdbUrl) {
      throw new Error('No AlphaFold DB prediction found for UniProt accession "' + acc + '".');
    }
    const pdbUrl = payload[0].pdbUrl;
    const pdbRes = await fetchWithTimeout(pdbUrl, { method: 'GET' }, FETCH_TIMEOUT_MS);
    if (!pdbRes.ok) {
      throw new Error('Failed to fetch AlphaFold PDB file (HTTP ' + pdbRes.status + ').');
    }
    const pdbText = await pdbRes.text();
    if (!pdbText || pdbText.indexOf('ATOM') === -1) {
      throw new Error('AlphaFold PDB response did not contain valid atomic coordinates.');
    }
    return {
      pdbText: pdbText,
      sourceLabel: 'AlphaFold DB prediction (' + acc + ')'
    };
  }

  async function loadFromSequence(sequence) {
    const seq = String(sequence || '').trim().toUpperCase();
    if (!seq || seq.length < 2) {
      throw new Error('Analyze a valid protein sequence first before folding with ESMFold.');
    }
    if (seq.length > ESMFOLD_MAX_LENGTH) {
      throw new Error(
        'Sequence is ' +
          seq.length.toLocaleString() +
          ' residues; the public ESMFold API supports up to ' +
          ESMFOLD_MAX_LENGTH +
          ' residues.'
      );
    }
    const res = await fetchWithTimeout(
      'https://api.esmatlas.com/foldSequence/v1/pdb/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: seq
      },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      const detail = await res.text().catch(function () {
        return '';
      });
      throw new Error(
        'ESMFold API returned HTTP ' + res.status + (detail ? ': ' + detail.slice(0, 120) : '.')
      );
    }
    const pdbText = await res.text();
    if (!pdbText || pdbText.indexOf('ATOM') === -1) {
      throw new Error('ESMFold response did not contain valid PDB coordinates.');
    }
    return {
      pdbText: pdbText,
      sourceLabel: 'ESMFold prediction (' + seq.length + ' aa)'
    };
  }

  function updateTheme() {
    if (!viewer) return;
    viewer.setBackgroundColor(getBackgroundHex());
    viewer.render();
  }

  function setSpin(enabled) {
    isSpinning = !!enabled;
    if (!viewer) return;
    if (isSpinning) {
      viewer.spin('y', 0.8);
    } else {
      viewer.spin(false);
    }
  }

  function resetView() {
    if (!viewer) return;
    viewer.zoomTo();
    viewer.render();
  }

  function resize() {
    if (!viewer) return;
    viewer.resize();
    viewer.render();
  }

  function clear() {
    currentPdbText = null;
    currentSourceLabel = '';
    if (viewer) {
      viewer.removeAllSurfaces();
      viewer.clear();
      viewer.render();
    }
  }

  NS.StructureViewer = {
    ESMFOLD_MAX_LENGTH: ESMFOLD_MAX_LENGTH,
    is3DmolAvailable: is3DmolAvailable,
    loadFromPdbId: loadFromPdbId,
    loadFromUniProt: loadFromUniProt,
    loadFromSequence: loadFromSequence,
    renderPdb: renderPdb,
    applyRepresentation: applyRepresentation,
    updateTheme: updateTheme,
    setSpin: setSpin,
    resetView: resetView,
    resize: resize,
    clear: clear,
    getSourceLabel: function () {
      return currentSourceLabel;
    },
    hasStructure: function () {
      return !!currentPdbText;
    }
  };
})(window);
