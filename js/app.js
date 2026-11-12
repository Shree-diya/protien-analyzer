(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  const VIEW_LABELS = {
    overview: 'Overview',
    input: 'Sequence Input',
    formation: '3D Formation',
    composition: 'Composition',
    groups: 'Group Models',
    hydrophobicity: 'Hydrophobicity',
    structure: 'Real Structure',
    methods: 'Methods & Export'
  };

  const state = {
    inWorkspace: false,
    activeView: 'overview',
    overview3dMode: 'formation', // 'formation' | 'structure'
    records: [],
    selectedRecordIndex: 0,
    analysis: null,
    activeGroupModel: 'sideChain',
    sortKey: 'code',
    sortDir: 'asc',
    pH: 7.0,
    windowSize: 9,
    groupBreakdown: null,
    profile: null,
    resultsRevealed: false,
    structMode: 'pdb',
    structStyle: 'cartoon',
    structSpin: false,
    selectedExample: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n, decimals) {
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /* =========================================================
     THEME
     ========================================================= */
  function initTheme() {
    let saved = 'dark';
    try {
      saved = localStorage.getItem('psa_theme') || 'dark';
    } catch (_e) {
      saved = 'dark';
    }
    applyTheme(saved);
  }

  function applyTheme(theme) {
    const mode = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', mode);

    const wsBtn = el('btn-theme-toggle');
    if (wsBtn) wsBtn.textContent = mode === 'dark' ? 'Light' : 'Dark';

    const landBtn = el('btn-landing-theme');
    if (landBtn) landBtn.textContent = mode === 'dark' ? 'Light Mode' : 'Dark Mode';

    try {
      localStorage.setItem('psa_theme', mode);
    } catch (_e) {}

    if (NS.Simulation) NS.Simulation.updateSceneBackground();
    if (NS.StructureViewer) NS.StructureViewer.updateTheme();
    if (state.analysis && state.analysis.ok && state.resultsRevealed) {
      renderChartsForActiveView();
    }
  }

  /* =========================================================
     LANDING & WORKSPACE NAVIGATION
     ========================================================= */
  function enterWorkspace(initialView, exampleId) {
    state.inWorkspace = true;
    const landing = el('landing-view');
    const ws = el('workspace-view');
    if (landing) landing.classList.add('hidden');
    if (ws) ws.classList.remove('hidden');
    if (NS.LandingScene) NS.LandingScene.stop();

    navigateTo(initialView || 'overview');

    if (exampleId) {
      loadExampleById(exampleId);
    }
  }

  function returnToLanding() {
    state.inWorkspace = false;
    const landing = el('landing-view');
    const ws = el('workspace-view');
    if (ws) ws.classList.add('hidden');
    if (landing) landing.classList.remove('hidden');
    if (NS.LandingScene) NS.LandingScene.start(el('landing-canvas'));
  }

  function closeMobileSidebar() {
    const sb = el('sidebar');
    const bd = el('sidebar-backdrop');
    if (sb) sb.classList.remove('open');
    if (bd) bd.classList.remove('open');
  }

  function mount3DViewportsForCurrentView() {
    const simViewport = el('sim-viewport');
    const structWrap = el('struct-viewport-wrap');
    const ovSlot = el('overview-3d-slot');
    const formSlot = el('formation-3d-slot');
    const structSlot = el('structure-3d-slot');

    // Return each 3D viewport to its home slot first unless Overview is claiming one
    if (state.activeView === 'overview') {
      if (state.overview3dMode === 'formation') {
        if (structWrap && structSlot && structWrap.parentElement !== structSlot) {
          structWrap.classList.add('viewport-3d-tall');
          structSlot.appendChild(structWrap);
        }
        if (simViewport && ovSlot) {
          simViewport.classList.remove('viewport-3d-tall');
          if (simViewport.parentElement !== ovSlot) ovSlot.appendChild(simViewport);
          if (NS.Simulation) NS.Simulation.resize(simViewport);
        }
      } else {
        if (simViewport && formSlot && simViewport.parentElement !== formSlot) {
          simViewport.classList.add('viewport-3d-tall');
          formSlot.appendChild(simViewport);
        }
        if (structWrap && ovSlot) {
          structWrap.classList.remove('viewport-3d-tall');
          if (structWrap.parentElement !== ovSlot) ovSlot.appendChild(structWrap);
          if (NS.StructureViewer && NS.StructureViewer.hasStructure()) {
            NS.StructureViewer.resize();
          }
        }
      }
      updateOverviewStageHeader();
      return;
    }

    // Dedicated Formation tab
    if (simViewport && formSlot) {
      simViewport.classList.add('viewport-3d-tall');
      if (simViewport.parentElement !== formSlot) formSlot.appendChild(simViewport);
      if (state.activeView === 'formation' && NS.Simulation) {
        NS.Simulation.resize(simViewport);
      }
    }

    // Dedicated Real Structure tab
    if (structWrap && structSlot) {
      structWrap.classList.add('viewport-3d-tall');
      if (structWrap.parentElement !== structSlot) structSlot.appendChild(structWrap);
      if (state.activeView === 'structure' && NS.StructureViewer && NS.StructureViewer.hasStructure()) {
        NS.StructureViewer.resize();
      }
    }
  }

  function updateOverviewStageHeader() {
    const badge = el('overview-3d-badge');
    const simBar = el('overview-sim-bar');
    const isFormation = state.overview3dMode === 'formation';

    document.querySelectorAll('#overview-3d-mode button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === state.overview3dMode);
    });

    if (simBar) {
      simBar.classList.toggle('hidden', !isFormation);
    }

    if (badge) {
      if (isFormation) {
        badge.className = 'disclaimer-pill';
        badge.textContent = 'Illustrative model, not a predicted structure';
      } else {
        const src = NS.StructureViewer ? NS.StructureViewer.getSourceLabel() : '';
        if (src) {
          badge.className = 'source-pill';
          badge.textContent = src;
        } else {
          badge.className = 'pill';
          badge.textContent = 'Load PDB / AlphaFold / ESMFold in Real Structure tab';
        }
      }
    }
  }

  function navigateTo(viewId) {
    if (!VIEW_LABELS[viewId]) viewId = 'overview';
    state.activeView = viewId;

    // Show only the selected panel
    Object.keys(VIEW_LABELS).forEach(function (id) {
      const panel = el('panel-' + id);
      if (panel) panel.classList.toggle('hidden', id !== viewId);
    });

    // Update sidebar active state
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });

    const bcView = el('breadcrumb-view');
    if (bcView) bcView.textContent = VIEW_LABELS[viewId];

    closeMobileSidebar();

    // Ensure 3D canvas slots & Chart.js canvases match visible dimensions
    global.requestAnimationFrame(function () {
      mount3DViewportsForCurrentView();
      if (state.analysis && state.analysis.ok && state.resultsRevealed) {
        renderChartsForActiveView();
      }
    });
  }

  /* =========================================================
     ALERTS & BANNERS
     ========================================================= */
  function showError(message) {
    const banner = el('error-banner');
    const msgEl = el('error-message');
    if (msgEl) msgEl.textContent = message;
    if (banner) banner.classList.remove('hidden');
  }

  function hideError() {
    const banner = el('error-banner');
    if (banner) banner.classList.add('hidden');
  }

  function showWarning(excludedTotal, excludedList) {
    const banner = el('warning-banner');
    const msgEl = el('warning-message');
    const chipsEl = el('excluded-chips');
    if (!banner || !msgEl || !chipsEl) return;

    if (!excludedTotal || excludedTotal <= 0) {
      banner.classList.add('hidden');
      chipsEl.innerHTML = '';
      return;
    }

    msgEl.textContent =
      excludedTotal.toLocaleString() +
      ' non-standard or ambiguous character' +
      (excludedTotal === 1 ? '' : 's') +
      ' detected and excluded from percentages and property calculations:';

    chipsEl.innerHTML = excludedList
      .map(function (item) {
        return (
          '<span class="excluded-chip" title="' +
          escapeHtml(item.description) +
          '">' +
          escapeHtml(item.char) +
          ' &times; ' +
          item.count.toLocaleString() +
          '</span>'
        );
      })
      .join('');

    banner.classList.remove('hidden');
  }

  function toggleChartWarning(show) {
    const warn = el('chart-lib-warning');
    if (warn) warn.classList.toggle('hidden', !show);
  }

  /* =========================================================
     EXAMPLES & GROUPING MODELS
     ========================================================= */
  function populateExamples() {
    ['example-select', 'sidebar-example-select'].forEach(function (selectId) {
      const select = el(selectId);
      if (!select) return;
      NS.Constants.EXAMPLE_PROTEINS.forEach(function (ex) {
        const opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.name;
        select.appendChild(opt);
      });
    });
  }

  function syncExampleSelects(val) {
    ['example-select', 'sidebar-example-select'].forEach(function (id) {
      const sel = el(id);
      if (sel) sel.value = val || '';
    });
  }

  function loadExampleById(id) {
    const found = NS.Constants.EXAMPLE_PROTEINS.find(function (item) {
      return item.id === id;
    });
    if (!found) return;
    state.selectedExample = found;
    syncExampleSelects(id);
    const pill = el('file-name-pill');
    if (pill) pill.classList.add('hidden');
    el('seq-input').value = typeof found.getFasta === 'function' ? found.getFasta() : found.fasta;
    updateRawCharCount();
    parseAndAnalyzeInput();
  }

  function setGroupingModel(modelId) {
    state.activeGroupModel = modelId;
    updateGroupSwitchersActive();
    renderSimLegend();
    if (NS.Simulation) {
      NS.Simulation.applyGroupColors(modelId);
    }
    if (NS.StructureViewer && NS.StructureViewer.hasStructure()) {
      NS.StructureViewer.applyRepresentation(state.structStyle, modelId);
    }
    if (state.analysis && state.analysis.ok && state.resultsRevealed) {
      renderGroupSection();
      renderCompositionSection();
      renderOverviewAnalytics();
    }
  }

  function buildGroupModelSwitchers() {
    const models = NS.Constants.GROUPING_MODELS;
    ['group-model-switcher', 'sim-model-switcher'].forEach(function (containerId) {
      const container = el(containerId);
      if (!container) return;
      container.innerHTML = '';
      Object.keys(models).forEach(function (key) {
        const m = models[key];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = m.label;
        btn.setAttribute('data-model', m.id);
        btn.setAttribute('role', 'tab');
        btn.className = m.id === state.activeGroupModel ? 'active' : '';
        btn.addEventListener('click', function () {
          setGroupingModel(m.id);
        });
        container.appendChild(btn);
      });
    });
    renderSimLegend();
  }

  function updateGroupSwitchersActive() {
    ['group-model-switcher', 'sim-model-switcher'].forEach(function (containerId) {
      const container = el(containerId);
      if (!container) return;
      container.querySelectorAll('button').forEach(function (btn) {
        const active = btn.getAttribute('data-model') === state.activeGroupModel;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });
  }

  function renderSimLegend() {
    const legend = el('sim-legend');
    if (!legend) return;
    const model =
      NS.Constants.GROUPING_MODELS[state.activeGroupModel] || NS.Constants.GROUPING_MODELS.sideChain;
    legend.innerHTML = model.groups
      .map(function (g) {
        return (
          '<span class="sim-legend-item">' +
          '<span class="color-dot" style="background:' +
          g.color +
          '"></span>' +
          '<strong>' +
          escapeHtml(g.label) +
          '</strong>' +
          '<span class="mono">(' +
          g.residues.join('') +
          ')</span>' +
          '</span>'
        );
      })
      .join('');
  }

  function updateMultiFastaBanner() {
    const banner = el('multi-fasta-banner');
    const msgEl = el('multi-fasta-msg');
    const select = el('record-select');
    if (!banner || !msgEl || !select) return;

    if (state.records.length <= 1) {
      banner.classList.add('hidden');
      select.innerHTML = '';
      return;
    }

    msgEl.textContent =
      'Multi-FASTA detected (' +
      state.records.length +
      ' records). Showing record #' +
      (state.selectedRecordIndex + 1) +
      ':';

    select.innerHTML = state.records
      .map(function (rec, idx) {
        const label = '#' + (idx + 1) + ': ' + rec.header.slice(0, 60);
        return (
          '<option value="' +
          idx +
          '"' +
          (idx === state.selectedRecordIndex ? ' selected' : '') +
          '>' +
          escapeHtml(label) +
          '</option>'
        );
      })
      .join('');

    banner.classList.remove('hidden');
  }

  /* =========================================================
     RENDERING ANALYTICS (Overview + Dedicated Views)
     ========================================================= */
  function getSortedComposition() {
    if (!state.analysis || !state.analysis.ok) return [];
    const list = state.analysis.composition.slice();
    const key = state.sortKey;
    const dir = state.sortDir === 'desc' ? -1 : 1;

    list.sort(function (a, b) {
      const va = a[key];
      const vb = b[key];
      if (typeof va === 'string') {
        return va.localeCompare(vb) * dir;
      }
      if (va === vb) {
        return a.code.localeCompare(b.code);
      }
      return (va - vb) * dir;
    });
    return list;
  }

  function updateSortIndicators() {
    document.querySelectorAll('#comp-table th.sortable').forEach(function (th) {
      const ind = th.querySelector('.sort-ind');
      if (!ind) return;
      const key = th.getAttribute('data-sort');
      if (key === state.sortKey) {
        ind.textContent = state.sortDir === 'asc' ? ' ▲' : ' ▼';
      } else {
        ind.textContent = '';
      }
    });
  }

  function renderSummaryCards() {
    const a = state.analysis;
    el('stat-length').textContent = a.validLength.toLocaleString() + ' aa';
    el('stat-length-sub').textContent =
      a.excludedTotal > 0
        ? a.excludedTotal.toLocaleString() + ' excluded character' + (a.excludedTotal === 1 ? '' : 's')
        : '0 excluded characters';

    el('stat-mw').textContent = formatNumber(a.molecularWeight, 2) + ' Da';
    el('stat-mw-sub').textContent = formatNumber(a.molecularWeight / 1000, 3) + ' kDa';

    el('stat-pi').textContent = formatNumber(a.pI, 2);

    const sign = a.netCharge > 0 ? '+' : '';
    el('stat-charge').textContent = sign + formatNumber(a.netCharge, 2);

    el('stat-gravy').textContent = formatNumber(a.gravy, 3);
    el('stat-gravy-sub').textContent =
      a.gravy > 0
        ? 'Overall hydrophobic (> 0)'
        : a.gravy < 0
        ? 'Overall hydrophilic (< 0)'
        : 'Hydropathy neutral (0)';

    el('stat-aliphatic').textContent = formatNumber(a.aliphaticIndex, 2);
  }

  function renderCompositionSection() {
    const sorted = getSortedComposition();
    const lookup =
      NS.Constants.RESIDUE_GROUP_LOOKUP[state.activeGroupModel] ||
      NS.Constants.RESIDUE_GROUP_LOOKUP.sideChain;

    const tbody = el('comp-tbody');
    const tfoot = el('comp-tfoot');
    if (tbody) {
      tbody.innerHTML = sorted
        .map(function (r) {
          const grp = lookup[r.code];
          const color = grp ? grp.color : '#64748b';
          const groupTitle = grp ? grp.label : '';
          return (
            '<tr>' +
            '<td><span class="aa-pill" title="' +
            escapeHtml(groupTitle) +
            '"><span class="color-dot" style="background:' +
            color +
            '"></span>' +
            r.code +
            ' (' +
            r.three +
            ')</span></td>' +
            '<td>' +
            escapeHtml(r.name) +
            '</td>' +
            '<td class="num-col">' +
            r.count.toLocaleString() +
            '</td>' +
            '<td class="num-col">' +
            r.percent.toFixed(2) +
            '%</td>' +
            '<td class="num-col">' +
            r.mass.toFixed(4) +
            '</td>' +
            '<td class="num-col">' +
            r.kd.toFixed(1) +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    }

    if (tfoot && state.analysis) {
      const totalPct = state.analysis.composition.reduce(function (acc, item) {
        return acc + item.percent;
      }, 0);
      tfoot.innerHTML =
        '<tr>' +
        '<td colspan="2">Total (20 standard amino acids)</td>' +
        '<td class="num-col">' +
        state.analysis.validLength.toLocaleString() +
        '</td>' +
        '<td class="num-col">' +
        totalPct.toFixed(2) +
        '%</td>' +
        '<td class="num-col">—</td>' +
        '<td class="num-col">—</td>' +
        '</tr>';
    }

    updateSortIndicators();
    if (state.activeView === 'composition') {
      const chartOk = NS.Charts.renderCompositionChart(
        el('chart-composition'),
        sorted,
        state.activeGroupModel
      );
      toggleChartWarning(!chartOk);
    }
  }

  function renderGroupSection() {
    const a = state.analysis;
    const breakdown = NS.Analyzer.computeGroupBreakdown(a.counts, a.validLength, state.activeGroupModel);
    state.groupBreakdown = breakdown;

    const descEl = el('group-model-desc');
    if (descEl) descEl.textContent = breakdown.modelDescription;

    const legendEl = el('group-legend');
    if (legendEl) {
      legendEl.innerHTML = breakdown.groups
        .map(function (g) {
          return (
            '<div class="legend-row">' +
            '<div class="legend-left">' +
            '<span class="color-dot" style="background:' +
            g.color +
            '"></span>' +
            '<div><strong>' +
            escapeHtml(g.label) +
            '</strong> <span class="legend-residues">(' +
            g.residues.join(', ') +
            ')</span></div>' +
            '</div>' +
            '<div class="legend-right">' +
            g.count.toLocaleString() +
            ' (' +
            g.percent.toFixed(2) +
            '%)</div>' +
            '</div>'
          );
        })
        .join('');
    }

    if (state.activeView === 'groups') {
      const chartOk = NS.Charts.renderGroupChart(el('chart-group'), breakdown);
      toggleChartWarning(!chartOk);
    }
  }

  function renderHydrophobicitySection() {
    const a = state.analysis;
    const profile = NS.Analyzer.computeHydrophobicityProfile(
      a.validSequence,
      state.windowSize,
      2000
    );
    state.profile = profile;

    const pill = el('profile-meta-pill');
    if (pill) {
      if (profile.downsampled) {
        pill.textContent =
          profile.totalWindows.toLocaleString() +
          ' windows → ' +
          profile.plottedPoints.toLocaleString() +
          ' plotted points (min-max downsampled)';
      } else {
        pill.textContent =
          profile.totalWindows.toLocaleString() +
          ' window' +
          (profile.totalWindows === 1 ? '' : 's') +
          ' plotted (window ' +
          profile.effectiveWindow +
          ' aa)';
      }
    }

    const noteEl = el('profile-note');
    if (noteEl) {
      if (profile.wasClamped) {
        noteEl.textContent =
          'Sequence length (' +
          a.validLength +
          ' aa) is shorter than requested window (' +
          profile.requestedWindow +
          ' aa); displaying effective window = ' +
          profile.effectiveWindow +
          ' aa.';
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    }

    if (state.activeView === 'hydrophobicity') {
      const chartOk = NS.Charts.renderHydrophobicityChart(el('chart-hydrophobicity'), profile);
      toggleChartWarning(!chartOk);
    }
  }

  function renderOverviewAnalytics() {
    const a = state.analysis;
    if (!a || !a.ok) return;

    const breakdown =
      state.groupBreakdown ||
      NS.Analyzer.computeGroupBreakdown(a.counts, a.validLength, state.activeGroupModel);
    state.groupBreakdown = breakdown;

    const profile =
      state.profile || NS.Analyzer.computeHydrophobicityProfile(a.validSequence, state.windowSize, 2000);
    state.profile = profile;

    // 4-KPI Insights Grid
    el('ov-stat-length').textContent = a.validLength.toLocaleString();
    el('ov-stat-length-sub').textContent =
      a.excludedTotal > 0 ? a.excludedTotal + ' excluded' : 'valid residues';
    el('ov-stat-mw').textContent = formatNumber(a.molecularWeight / 1000, 2) + ' kDa';
    el('ov-stat-mw-sub').textContent = formatNumber(a.molecularWeight, 1) + ' Da';
    el('ov-stat-pi').textContent = formatNumber(a.pI, 2);
    el('ov-stat-gravy').textContent = formatNumber(a.gravy, 3);
    el('ov-stat-gravy-sub').textContent = a.gravy >= 0 ? 'Hydrophobic' : 'Hydrophilic';

    // Top-right compact group legend
    el('ov-group-model-name').textContent = breakdown.modelLabel;
    el('ov-group-legend').innerHTML = breakdown.groups
      .slice()
      .sort(function (x, y) {
        return y.percent - x.percent;
      })
      .map(function (g) {
        return (
          '<div class="compact-legend-item">' +
          '<span class="compact-legend-name"><span class="color-dot" style="background:' +
          g.color +
          '"></span><span>' +
          escapeHtml(g.label) +
          '</span></span>' +
          '<span class="mono">' +
          g.percent.toFixed(1) +
          '%</span>' +
          '</div>'
        );
      })
      .join('');

    // Bottom 3 mini-panels
    const top5 = a.composition
      .slice()
      .sort(function (x, y) {
        return y.count - x.count;
      })
      .slice(0, 5);
    const lookup =
      NS.Constants.RESIDUE_GROUP_LOOKUP[state.activeGroupModel] ||
      NS.Constants.RESIDUE_GROUP_LOOKUP.sideChain;
    el('ov-top-residues').innerHTML = top5
      .map(function (r) {
        const grp = lookup[r.code];
        const c = grp ? grp.color : '#64748b';
        return (
          '<tr>' +
          '<td><span class="aa-pill"><span class="color-dot" style="background:' +
          c +
          '"></span>' +
          r.code +
          ' (' +
          r.three +
          ')</span></td>' +
          '<td class="num-col">' +
          r.count.toLocaleString() +
          '</td>' +
          '<td class="num-col">' +
          r.percent.toFixed(1) +
          '%</td>' +
          '</tr>'
        );
      })
      .join('');

    const sign = a.netCharge > 0 ? '+' : '';
    el('ov-ph-label').textContent = a.pH.toFixed(1);
    el('ov-charge').textContent = sign + formatNumber(a.netCharge, 2);
    el('ov-aliphatic').textContent = formatNumber(a.aliphaticIndex, 2);
    el('ov-excluded').textContent = a.excludedTotal.toLocaleString();
    el('ov-win-label').textContent = profile.effectiveWindow + ' aa';

    const topGroup = breakdown.groups.slice().sort(function (x, y) {
      return y.percent - x.percent;
    })[0];
    el('ov-summary-text').textContent =
      a.header.slice(0, 48) +
      ': ' +
      a.validLength.toLocaleString() +
      ' aa chain dominated by ' +
      topGroup.label.toLowerCase() +
      ' residues (' +
      topGroup.percent.toFixed(1) +
      '%). ' +
      (a.gravy >= 0 ? 'Net hydrophobic character.' : 'Net hydrophilic character.') +
      ' pI ' +
      a.pI.toFixed(2) +
      ' (EMBOSS pKa).';

    if (state.activeView === 'overview') {
      const ok1 = NS.Charts.renderOverviewGroupBarChart(el('chart-overview-comp'), breakdown);
      const ok2 = NS.Charts.renderOverviewHydroChart(el('chart-overview-hydro'), profile);
      toggleChartWarning(!ok1 || !ok2);
    }
  }

  function renderChartsForActiveView() {
    if (!state.analysis || !state.analysis.ok) return;
    if (state.activeView === 'overview') {
      renderOverviewAnalytics();
    } else if (state.activeView === 'composition') {
      renderCompositionSection();
    } else if (state.activeView === 'groups') {
      renderGroupSection();
    } else if (state.activeView === 'hydrophobicity') {
      renderHydrophobicitySection();
    }
  }

  /* =========================================================
     SIMULATION -> REVEAL FLOW
     ========================================================= */
  function setExportButtonsEnabled(enabled) {
    ['btn-export-csv', 'btn-methods-export-csv'].forEach(function (id) {
      const btn = el(id);
      if (btn) btn.disabled = !enabled;
    });
  }

  function hideAllOutputs() {
    state.resultsRevealed = false;
    setExportButtonsEnabled(false);

    const ovEmpty = el('overview-empty');
    const ovBento = el('overview-bento');
    if (ovEmpty) ovEmpty.classList.remove('hidden');
    if (ovBento) ovBento.classList.add('hidden');

    el('nav-badge-len').textContent = '—';
    el('breadcrumb-seq').textContent = 'No sequence';
    el('topbar-model-pill').classList.add('hidden');

    el('sidebar-status-title').textContent = 'No Sequence';
    el('sidebar-status-pct').textContent = '0%';
    el('sidebar-progress-fill').style.width = '0%';
    el('sidebar-status-sub').textContent = 'Load or paste a protein sequence';
  }

  function revealAnalysisResults() {
    if (!state.analysis || !state.analysis.ok) return;
    state.resultsRevealed = true;
    setExportButtonsEnabled(true);

    const lockOverlay = el('overview-lock-overlay');
    if (lockOverlay) lockOverlay.classList.add('hidden');

    const revealBtn = el('btn-sim-reveal');
    if (revealBtn) revealBtn.classList.add('hidden');
    const ovRevealBtn = el('btn-ov-reveal');
    if (ovRevealBtn) ovRevealBtn.classList.add('hidden');

    renderSummaryCards();
    renderGroupSection();
    renderCompositionSection();
    renderHydrophobicitySection();
    renderOverviewAnalytics();
    syncRealStructureHelperDefaults();
  }

  function updateSimProgressUI(info) {
    const pct = info.total > 0 ? Math.round((info.visible / info.total) * 100) : 0;
    const countText = info.visible.toLocaleString() + ' / ' + info.total.toLocaleString() + ' aa';

    ['sim-scrub', 'ov-scrub'].forEach(function (id) {
      const s = el(id);
      if (s) {
        s.max = String(Math.max(1, info.total));
        s.value = String(info.visible);
      }
    });

    ['sim-count-pill', 'ov-count-pill'].forEach(function (id) {
      const p = el(id);
      if (p) p.textContent = countText;
    });

    ['btn-sim-play', 'btn-ov-play'].forEach(function (id) {
      const b = el(id);
      if (b) b.textContent = info.isPlaying ? 'Pause' : info.isComplete ? 'Replay' : 'Play';
    });

    el('sidebar-status-pct').textContent = pct + '%';
    el('sidebar-progress-fill').style.width = pct + '%';

    const statusText = el('sim-status-text');
    if (statusText) {
      if (info.isComplete) {
        statusText.textContent =
          'Full polypeptide chain formed (' +
          info.total.toLocaleString() +
          ' residues). Analysis unlocked across all tabs.';
      } else {
        statusText.textContent =
          'Synthesizing chain: ' +
          info.visible.toLocaleString() +
          ' / ' +
          info.total.toLocaleString() +
          ' residues (analysis unlocks once full chain completes)...';
      }
    }

    const lockMsg = el('lock-overlay-msg');
    if (lockMsg && !info.isComplete) {
      lockMsg.textContent =
        'Synthesizing residue ' +
        info.visible.toLocaleString() +
        ' of ' +
        info.total.toLocaleString() +
        ' (' +
        pct +
        '%). Composition & properties unlock once the full chain is formed.';
    }

    const showReveal = !info.isComplete && !state.resultsRevealed;
    const revealBtn = el('btn-sim-reveal');
    if (revealBtn) revealBtn.classList.toggle('hidden', !showReveal);
    const ovRevealBtn = el('btn-ov-reveal');
    if (ovRevealBtn) ovRevealBtn.classList.toggle('hidden', !showReveal);
  }

  function startFormationSimulation(sequence) {
    const emptyOverlay = el('sim-empty-overlay');
    if (emptyOverlay) emptyOverlay.classList.add('hidden');

    const webglWarn = el('sim-webgl-warning');
    const viewport = el('sim-viewport');

    state.overview3dMode = 'formation';
    if (state.activeView !== 'overview' && state.activeView !== 'formation') {
      navigateTo('overview');
    } else {
      mount3DViewportsForCurrentView();
    }

    ['sim-scrub', 'ov-scrub'].forEach(function (id) {
      const s = el(id);
      if (s) {
        s.min = '1';
        s.max = String(sequence.length);
        s.value = '1';
      }
    });

    const ok = NS.Simulation.loadSequence(viewport, sequence, state.activeGroupModel, {
      onProgress: updateSimProgressUI,
      onComplete: function () {
        revealAnalysisResults();
      }
    });

    if (webglWarn) webglWarn.classList.toggle('hidden', ok);
    if (!ok) {
      revealAnalysisResults();
    }
  }

  /* =========================================================
     REAL STRUCTURE VIEWER
     ========================================================= */
  function syncRealStructureHelperDefaults() {
    const modeSelect = el('struct-mode');
    const idInput = el('struct-id-input');
    if (!modeSelect || !idInput) return;

    if (state.selectedExample) {
      if (state.selectedExample.pdbId) {
        state.structMode = 'pdb';
        modeSelect.value = 'pdb';
        idInput.value = state.selectedExample.pdbId;
      } else if (state.selectedExample.uniprotId) {
        state.structMode = 'uniprot';
        modeSelect.value = 'uniprot';
        idInput.value = state.selectedExample.uniprotId;
      } else if (state.analysis && state.analysis.validLength <= NS.StructureViewer.ESMFOLD_MAX_LENGTH) {
        state.structMode = 'sequence';
        modeSelect.value = 'sequence';
        idInput.value = '';
      }
    }
    updateStructInputModeUI();
  }

  function updateStructInputModeUI() {
    const idInput = el('struct-id-input');
    if (!idInput) return;
    if (state.structMode === 'pdb') {
      idInput.disabled = false;
      idInput.placeholder = 'PDB ID (e.g. 1UBQ, 1EMA)';
    } else if (state.structMode === 'uniprot') {
      idInput.disabled = false;
      idInput.placeholder = 'UniProt accession (e.g. P0CG48, P42212)';
    } else {
      idInput.disabled = true;
      idInput.placeholder = 'Uses currently analyzed sequence (<=400 aa)';
    }
  }

  async function handleLoadStructure() {
    const errBanner = el('struct-error-banner');
    const errMsg = el('struct-error-message');
    const spinner = el('struct-spinner');
    const spinnerText = el('struct-spinner-text');
    const emptyOverlay = el('struct-empty-overlay');
    const sourcePill = el('struct-source-pill');
    const loadBtn = el('btn-struct-load');
    const viewport = el('struct-viewport');

    if (errBanner) errBanner.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
    if (loadBtn) loadBtn.disabled = true;

    try {
      let result;
      if (state.structMode === 'pdb') {
        const id = el('struct-id-input').value;
        if (spinnerText) spinnerText.textContent = 'Fetching experimental PDB from RCSB (timeout 30 s)...';
        result = await NS.StructureViewer.loadFromPdbId(id);
      } else if (state.structMode === 'uniprot') {
        const acc = el('struct-id-input').value;
        if (spinnerText) spinnerText.textContent = 'Querying AlphaFold DB prediction (timeout 30 s)...';
        result = await NS.StructureViewer.loadFromUniProt(acc);
      } else {
        const seq = state.analysis && state.analysis.ok ? state.analysis.validSequence : '';
        if (spinnerText) spinnerText.textContent = 'Folding sequence via ESMFold API (timeout 30 s)...';
        result = await NS.StructureViewer.loadFromSequence(seq);
      }

      NS.StructureViewer.renderPdb(
        viewport,
        result.pdbText,
        result.sourceLabel,
        state.structStyle,
        state.activeGroupModel
      );
      if (emptyOverlay) emptyOverlay.classList.add('hidden');
      if (sourcePill) {
        sourcePill.textContent = result.sourceLabel;
        sourcePill.classList.remove('hidden');
      }
      if (state.activeView === 'overview') {
        updateOverviewStageHeader();
      }
    } catch (err) {
      const reason =
        err && err.name === 'AbortError'
          ? 'Request timed out after 30 seconds.'
          : err && err.message
          ? err.message
          : String(err);
      if (errMsg) errMsg.textContent = reason;
      if (errBanner) errBanner.classList.remove('hidden');
    } finally {
      if (spinner) spinner.classList.add('hidden');
      if (loadBtn) loadBtn.disabled = false;
    }
  }

  /* =========================================================
     CORE PARSE & RUN PIPELINE
     ========================================================= */
  function runAnalysisOnSelectedRecord() {
    try {
      hideError();
      if (!state.records || state.records.length === 0) {
        state.analysis = null;
        showWarning(0, []);
        hideAllOutputs();
        showError('Please paste a protein sequence, upload a FASTA/text file, or select an example protein.');
        return;
      }

      const rec = state.records[state.selectedRecordIndex] || state.records[0];
      const result = NS.Analyzer.analyzeRecord(rec, { pH: state.pH });
      state.analysis = result;

      if (!result.ok) {
        showWarning(0, []);
        hideAllOutputs();
        showError(result.errorMessage);
        return;
      }

      state.resultsRevealed = false;
      state.groupBreakdown = null;
      state.profile = null;
      setExportButtonsEnabled(false);

      const structErr = el('struct-error-banner');
      if (structErr) structErr.classList.add('hidden');

      showWarning(result.excludedTotal, result.excludedList);

      // Show Overview Bento with Lock Overlay while chain synthesizes
      el('overview-empty').classList.add('hidden');
      el('overview-bento').classList.remove('hidden');
      el('overview-lock-overlay').classList.remove('hidden');

      const shortName = result.header.slice(0, 34);
      el('breadcrumb-seq').textContent = shortName + ' (' + result.validLength.toLocaleString() + ' aa)';
      el('nav-badge-len').textContent = result.validLength.toLocaleString();
      el('topbar-model-pill').classList.remove('hidden');
      el('sidebar-status-title').textContent = result.validLength.toLocaleString() + ' aa';
      el('sidebar-status-sub').textContent =
        result.excludedTotal > 0 ? result.excludedTotal + ' excluded chars' : 'Valid polypeptide chain';

      startFormationSimulation(result.validSequence);
    } catch (err) {
      hideAllOutputs();
      showError('Unexpected analysis error: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function parseAndAnalyzeInput() {
    try {
      const rawText = el('seq-input').value;
      state.records = NS.Analyzer.parseFastaRecords(rawText);
      state.selectedRecordIndex = 0;
      updateMultiFastaBanner();
      runAnalysisOnSelectedRecord();
    } catch (err) {
      hideAllOutputs();
      showError('Failed to parse input: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function handleFileObject(file) {
    if (!file) return;
    state.selectedExample = null;
    syncExampleSelects('');
    const pill = el('file-name-pill');
    if (pill) {
      pill.textContent = file.name + ' (' + formatNumber(file.size / 1024, 1) + ' KB)';
      pill.classList.remove('hidden');
    }

    const reader = new FileReader();
    reader.onload = function (ev) {
      el('seq-input').value = ev.target && typeof ev.target.result === 'string' ? ev.target.result : '';
      updateRawCharCount();
      parseAndAnalyzeInput();
    };
    reader.onerror = function () {
      showError('Could not read file "' + file.name + '". Please ensure it is a valid text or FASTA file.');
    };
    reader.readAsText(file);
  }

  function updateRawCharCount() {
    const val = el('seq-input').value;
    const countEl = el('raw-char-count');
    if (countEl) {
      countEl.textContent = val.length.toLocaleString() + ' characters in input';
    }
  }

  function exportCsv() {
    if (!state.analysis || !state.analysis.ok) return;
    const csv = NS.Analyzer.exportAnalysisToCsv(state.analysis, state.groupBreakdown);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'protein-analysis.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* =========================================================
     EVENT BINDINGS
     ========================================================= */
  function bindEvents() {
    // Landing page buttons
    el('btn-landing-enter-top').addEventListener('click', function () {
      enterWorkspace('overview');
    });
    el('btn-landing-launch').addEventListener('click', function () {
      enterWorkspace('input');
    });
    el('btn-landing-demo-ubiq').addEventListener('click', function () {
      enterWorkspace('overview', 'ubiquitin');
    });
    el('btn-landing-demo-35k').addEventListener('click', function () {
      enterWorkspace('overview', 'long-35k');
    });
    el('btn-landing-theme').addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Sidebar navigation
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const view = btn.getAttribute('data-view');
        if (view) navigateTo(view);
      });
    });

    // Jump links inside Overview mini-cards
    document.querySelectorAll('[data-jump]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-jump');
        if (target) navigateTo(target);
      });
    });

    // Mobile sidebar drawer
    el('btn-mobile-menu').addEventListener('click', function () {
      el('sidebar').classList.toggle('open');
      el('sidebar-backdrop').classList.toggle('open');
    });
    el('sidebar-backdrop').addEventListener('click', closeMobileSidebar);

    // Topbar actions & Back home
    el('btn-back-home').addEventListener('click', returnToLanding);
    el('btn-new-analysis').addEventListener('click', function () {
      navigateTo('input');
    });
    el('btn-top-methods').addEventListener('click', function () {
      navigateTo('methods');
    });
    el('btn-export-csv').addEventListener('click', exportCsv);
    el('btn-methods-export-csv').addEventListener('click', exportCsv);
    el('btn-theme-toggle').addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Overview empty shortcuts & 3D mode switcher
    el('btn-ov-go-input').addEventListener('click', function () {
      navigateTo('input');
    });
    el('btn-ov-load-ubiq').addEventListener('click', function () {
      loadExampleById('ubiquitin');
    });
    el('btn-ov-load-35k').addEventListener('click', function () {
      loadExampleById('long-35k');
    });

    document.querySelectorAll('#overview-3d-mode button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const mode = btn.getAttribute('data-mode');
        if (!mode) return;
        state.overview3dMode = mode;
        mount3DViewportsForCurrentView();
      });
    });

    // Input textarea & file upload
    const textarea = el('seq-input');
    textarea.addEventListener('input', function () {
      state.selectedExample = null;
      syncExampleSelects('');
      updateRawCharCount();
    });
    textarea.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        parseAndAnalyzeInput();
      }
    });
    textarea.addEventListener('dragover', function (e) {
      e.preventDefault();
      textarea.classList.add('drag-over');
    });
    textarea.addEventListener('dragleave', function () {
      textarea.classList.remove('drag-over');
    });
    textarea.addEventListener('drop', function (e) {
      e.preventDefault();
      textarea.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileObject(e.dataTransfer.files[0]);
      }
    });

    el('btn-analyze').addEventListener('click', parseAndAnalyzeInput);

    el('btn-clear').addEventListener('click', function () {
      textarea.value = '';
      syncExampleSelects('');
      el('file-input').value = '';
      el('file-name-pill').classList.add('hidden');
      state.records = [];
      state.analysis = null;
      state.selectedExample = null;
      if (NS.Simulation) NS.Simulation.pause();
      if (NS.StructureViewer) NS.StructureViewer.clear();
      const emptyOverlay = el('struct-empty-overlay');
      if (emptyOverlay) emptyOverlay.classList.remove('hidden');
      const sourcePill = el('struct-source-pill');
      if (sourcePill) sourcePill.classList.add('hidden');
      updateRawCharCount();
      updateMultiFastaBanner();
      hideError();
      showWarning(0, []);
      hideAllOutputs();
    });

    el('btn-upload-file').addEventListener('click', function () {
      el('file-input').click();
    });
    el('file-input').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileObject(file);
    });

    ['example-select', 'sidebar-example-select'].forEach(function (id) {
      el(id).addEventListener('change', function (e) {
        if (e.target.value) loadExampleById(e.target.value);
      });
    });

    el('record-select').addEventListener('change', function (e) {
      const idx = parseInt(e.target.value, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < state.records.length) {
        state.selectedRecordIndex = idx;
        updateMultiFastaBanner();
        runAnalysisOnSelectedRecord();
      }
    });

    // Formation simulation controls (both dedicated Formation view & Overview compact bar)
    ['btn-sim-play', 'btn-ov-play'].forEach(function (id) {
      el(id).addEventListener('click', function () {
        const s = NS.Simulation.getState();
        if (s.isPlaying) NS.Simulation.pause();
        else NS.Simulation.play();
      });
    });
    ['btn-sim-restart', 'btn-ov-restart'].forEach(function (id) {
      el(id).addEventListener('click', function () {
        NS.Simulation.restart();
      });
    });
    ['btn-sim-reveal', 'btn-ov-reveal', 'btn-lock-reveal'].forEach(function (id) {
      el(id).addEventListener('click', function () {
        NS.Simulation.completeNow();
      });
    });
    ['sim-scrub', 'ov-scrub'].forEach(function (id) {
      el(id).addEventListener('input', function (e) {
        const cnt = parseInt(e.target.value, 10);
        if (!Number.isNaN(cnt)) NS.Simulation.scrubTo(cnt);
      });
    });
    el('btn-sim-reset-cam').addEventListener('click', function () {
      NS.Simulation.resetCamera();
    });
    el('sim-speed').addEventListener('input', function (e) {
      const spd = parseFloat(e.target.value);
      if (Number.isNaN(spd)) return;
      el('sim-speed-val').textContent = spd.toFixed(2).replace(/\.00$/, '.0') + 'x';
      NS.Simulation.setSpeed(spd);
    });

    // Real structure viewer controls
    el('struct-mode').addEventListener('change', function (e) {
      state.structMode = e.target.value;
      updateStructInputModeUI();
    });
    el('btn-struct-load').addEventListener('click', handleLoadStructure);
    el('struct-id-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLoadStructure();
      }
    });
    document.querySelectorAll('#struct-style-switcher button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const style = btn.getAttribute('data-style');
        if (!style) return;
        state.structStyle = style;
        document.querySelectorAll('#struct-style-switcher button').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        if (NS.StructureViewer && NS.StructureViewer.hasStructure()) {
          NS.StructureViewer.applyRepresentation(style, state.activeGroupModel);
        }
      });
    });
    el('btn-struct-spin').addEventListener('click', function () {
      state.structSpin = !state.structSpin;
      const btn = el('btn-struct-spin');
      btn.textContent = state.structSpin ? 'Spin: On' : 'Spin: Off';
      btn.setAttribute('aria-pressed', state.structSpin ? 'true' : 'false');
      if (NS.StructureViewer) NS.StructureViewer.setSpin(state.structSpin);
    });
    el('btn-struct-reset').addEventListener('click', function () {
      if (NS.StructureViewer) NS.StructureViewer.resetView();
    });

    // pH live update
    el('ph-input').addEventListener('input', function (e) {
      let val = parseFloat(e.target.value);
      if (Number.isNaN(val)) return;
      val = Math.max(0, Math.min(14, val));
      state.pH = val;
      if (state.analysis && state.analysis.ok) {
        state.analysis.pH = val;
        state.analysis.netCharge = NS.Analyzer.computeNetCharge(state.analysis.counts, val);
        const sign = state.analysis.netCharge > 0 ? '+' : '';
        el('stat-charge').textContent = sign + formatNumber(state.analysis.netCharge, 2);
        el('ov-ph-label').textContent = val.toFixed(1);
        el('ov-charge').textContent = sign + formatNumber(state.analysis.netCharge, 2);
      }
    });

    // Sliding window live update
    el('window-slider').addEventListener('input', function (e) {
      const w = parseInt(e.target.value, 10);
      if (Number.isNaN(w)) return;
      state.windowSize = w;
      el('window-value').textContent = String(w);
      if (state.analysis && state.analysis.ok && state.resultsRevealed) {
        renderHydrophobicitySection();
        renderOverviewAnalytics();
      }
    });

    // Table sorting
    document.querySelectorAll('#comp-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        const key = th.getAttribute('data-sort');
        if (!key) return;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'code' || key === 'name' ? 'asc' : 'desc';
        }
        if (state.analysis && state.analysis.ok && state.resultsRevealed) {
          renderCompositionSection();
        }
      });
    });

    // PNG Exports
    el('btn-png-composition').addEventListener('click', function () {
      NS.Charts.downloadChartPng('composition', 'amino-acid-composition.png');
    });
    el('btn-png-group').addEventListener('click', function () {
      NS.Charts.downloadChartPng('group', 'group-breakdown.png');
    });
    el('btn-png-hydro').addEventListener('click', function () {
      NS.Charts.downloadChartPng('hydrophobicity', 'hydrophobicity-profile.png');
    });
  }

  function init() {
    initTheme();
    populateExamples();
    buildGroupModelSwitchers();
    updateStructInputModeUI();
    bindEvents();
    updateRawCharCount();

    // Start ambient 3D landing animation on initial load
    if (NS.LandingScene) {
      NS.LandingScene.start(el('landing-canvas'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
