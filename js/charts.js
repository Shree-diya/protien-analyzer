(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  const chartInstances = {
    composition: null,
    group: null,
    hydrophobicity: null,
    overviewComp: null,
    overviewHydro: null
  };

  function getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
      isDark: isDark,
      text: isDark ? '#e2e8f0' : '#0f172a',
      muted: isDark ? '#8b98b8' : '#64748b',
      grid: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(15, 23, 42, 0.08)',
      zeroLine: isDark ? 'rgba(226, 232, 240, 0.3)' : 'rgba(15, 23, 42, 0.35)',
      surface: isDark ? '#0e1322' : '#ffffff',
      lineColor: isDark ? '#8b5cf6' : '#6d28d9',
      lineAccent: isDark ? '#38bdf8' : '#0284c7',
      lineFillTop: isDark ? 'rgba(139, 92, 246, 0.25)' : 'rgba(109, 40, 217, 0.16)'
    };
  }

  function ensureChartJsAvailable() {
    return typeof global.Chart !== 'undefined';
  }

  function destroyChart(key) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      chartInstances[key] = null;
    }
  }

  /**
   * Renders or updates the 20-residue composition bar chart.
   */
  function renderCompositionChart(canvas, sortedComposition, modelKey) {
    if (!canvas || !ensureChartJsAvailable()) return false;
    const theme = getThemeColors();
    const lookup = NS.Constants.RESIDUE_GROUP_LOOKUP[modelKey] || NS.Constants.RESIDUE_GROUP_LOOKUP.sideChain;

    const labels = sortedComposition.map(function (r) {
      return r.code;
    });
    const data = sortedComposition.map(function (r) {
      return Number(r.percent.toFixed(2));
    });
    const counts = sortedComposition.map(function (r) {
      return r.count;
    });
    const names = sortedComposition.map(function (r) {
      return r.three + ' (' + r.name + ')';
    });
    const colors = sortedComposition.map(function (r) {
      const grp = lookup[r.code];
      return grp ? grp.color : '#64748b';
    });

    destroyChart('composition');

    chartInstances.composition = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Composition (%)',
            data: data,
            backgroundColor: colors,
            borderRadius: 5,
            borderSkipped: false,
            maxBarThickness: 30
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) {
                const idx = items[0].dataIndex;
                return labels[idx] + ' - ' + names[idx];
              },
              label: function (item) {
                const idx = item.dataIndex;
                return 'Count: ' + counts[idx].toLocaleString() + ' (' + data[idx].toFixed(2) + '%)';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.text, font: { weight: '600', size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: theme.grid },
            ticks: {
              color: theme.muted,
              callback: function (v) {
                return v + '%';
              }
            },
            title: {
              display: true,
              text: 'Percentage (%)',
              color: theme.muted
            }
          }
        }
      }
    });
    return true;
  }

  /**
   * Compact Overview bar chart showing group breakdown (matching screenshot's top-right panel).
   */
  function renderOverviewGroupBarChart(canvas, groupBreakdown) {
    if (!canvas || !ensureChartJsAvailable()) return false;
    const theme = getThemeColors();
    const sortedGroups = groupBreakdown.groups.slice().sort(function (a, b) {
      return b.percent - a.percent;
    });

    const labels = sortedGroups.map(function (g) {
      return g.label.split(' ')[0];
    });
    const fullLabels = sortedGroups.map(function (g) {
      return g.label;
    });
    const data = sortedGroups.map(function (g) {
      return Number(g.percent.toFixed(2));
    });
    const counts = sortedGroups.map(function (g) {
      return g.count;
    });
    const colors = sortedGroups.map(function (g) {
      return g.color;
    });

    destroyChart('overviewComp');

    chartInstances.overviewComp = new global.Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: colors,
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 26
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) {
                return fullLabels[items[0].dataIndex];
              },
              label: function (item) {
                const idx = item.dataIndex;
                return counts[idx].toLocaleString() + ' aa (' + data[idx].toFixed(2) + '%)';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.muted, font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: theme.grid },
            ticks: {
              color: theme.muted,
              font: { size: 10 },
              callback: function (v) {
                return v + '%';
              }
            }
          }
        }
      }
    });
    return true;
  }

  /**
   * Renders the switchable grouping model donut chart.
   */
  function renderGroupChart(canvas, groupBreakdown) {
    if (!canvas || !ensureChartJsAvailable()) return false;
    const theme = getThemeColors();

    const labels = groupBreakdown.groups.map(function (g) {
      return g.label;
    });
    const data = groupBreakdown.groups.map(function (g) {
      return Number(g.percent.toFixed(2));
    });
    const counts = groupBreakdown.groups.map(function (g) {
      return g.count;
    });
    const colors = groupBreakdown.groups.map(function (g) {
      return g.color;
    });

    destroyChart('group');

    chartInstances.group = new global.Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: colors,
            borderColor: theme.surface,
            borderWidth: 2,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        animation: { duration: 220 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) {
                const idx = item.dataIndex;
                return (
                  labels[idx] +
                  ': ' +
                  counts[idx].toLocaleString() +
                  ' residues (' +
                  data[idx].toFixed(2) +
                  '%)'
                );
              }
            }
          }
        }
      }
    });
    return true;
  }

  function buildHydroChartConfig(profile, theme, compact) {
    const points = profile.positions.map(function (pos, idx) {
      return { x: pos, y: profile.values[idx] };
    });

    const zeroLinePlugin = {
      id: 'kdZeroLine',
      beforeDatasetsDraw: function (chart) {
        const yScale = chart.scales.y;
        const xScale = chart.scales.x;
        if (!yScale || !xScale) return;
        const yZero = yScale.getPixelForValue(0);
        if (yZero < yScale.top || yZero > yScale.bottom) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = theme.zeroLine;
        ctx.lineWidth = 1;
        ctx.moveTo(xScale.left, yZero);
        ctx.lineTo(xScale.right, yZero);
        ctx.stroke();
        ctx.restore();
      }
    };

    return {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Kyte-Doolittle (win ' + profile.effectiveWindow + ')',
            data: points,
            borderColor: theme.lineAccent,
            backgroundColor: theme.lineFillTop,
            borderWidth: profile.plottedPoints > 600 ? 1.25 : 2,
            pointRadius: profile.plottedPoints <= 55 && !compact ? 2.5 : 0,
            pointHoverRadius: 4,
            fill: {
              target: { value: 0 },
              above: 'rgba(168, 85, 247, 0.18)',
              below: 'rgba(56, 189, 248, 0.16)'
            },
            tension: 0.22
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) {
                return 'Position ~' + items[0].parsed.x;
              },
              label: function (item) {
                const v = item.parsed.y;
                return 'KD: ' + v.toFixed(3) + ' (' + (v >= 0 ? 'Hydrophobic' : 'Hydrophilic') + ')';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            grid: { color: theme.grid },
            ticks: { color: theme.muted, maxTicksLimit: compact ? 6 : 10, font: { size: compact ? 10 : 11 } },
            title: {
              display: !compact,
              text: 'Sequence Position (window center)',
              color: theme.muted
            }
          },
          y: {
            suggestedMin: -4.2,
            suggestedMax: 4.2,
            grid: { color: theme.grid },
            ticks: { color: theme.muted, font: { size: compact ? 10 : 11 } },
            title: {
              display: !compact,
              text: 'Hydropathy (Kyte-Doolittle)',
              color: theme.muted
            }
          }
        }
      },
      plugins: [zeroLinePlugin]
    };
  }

  function renderHydrophobicityChart(canvas, profile) {
    if (!canvas || !ensureChartJsAvailable()) return false;
    destroyChart('hydrophobicity');
    chartInstances.hydrophobicity = new global.Chart(
      canvas.getContext('2d'),
      buildHydroChartConfig(profile, getThemeColors(), false)
    );
    return true;
  }

  function renderOverviewHydroChart(canvas, profile) {
    if (!canvas || !ensureChartJsAvailable()) return false;
    destroyChart('overviewHydro');
    chartInstances.overviewHydro = new global.Chart(
      canvas.getContext('2d'),
      buildHydroChartConfig(profile, getThemeColors(), true)
    );
    return true;
  }

  function downloadChartPng(chartKey, filename) {
    const instance = chartInstances[chartKey];
    if (!instance || !instance.canvas) return false;
    const srcCanvas = instance.canvas;
    const theme = getThemeColors();

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = srcCanvas.width;
    exportCanvas.height = srcCanvas.height;
    const ctx = exportCanvas.getContext('2d');
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(srcCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = filename || chartKey + '.png';
    link.href = exportCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  }

  NS.Charts = {
    renderCompositionChart: renderCompositionChart,
    renderOverviewGroupBarChart: renderOverviewGroupBarChart,
    renderGroupChart: renderGroupChart,
    renderHydrophobicityChart: renderHydrophobicityChart,
    renderOverviewHydroChart: renderOverviewHydroChart,
    downloadChartPng: downloadChartPng,
    ensureChartJsAvailable: ensureChartJsAvailable
  };
})(window);
