(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  function getConstants() {
    return NS.Constants;
  }

  /**
   * Parses raw text into one or more FASTA records (or a single unlabelled record).
   * Preserves header text and raw sequence lines for downstream cleaning/validation.
   */
  function parseFastaRecords(rawText) {
    const text = typeof rawText === 'string' ? rawText : '';
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }

    const lines = text.split(/\r?\n/);
    const records = [];
    let currentHeader = null;
    let currentLines = [];
    let sawHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('>')) {
        if (sawHeader || currentLines.length > 0) {
          records.push({
            index: records.length,
            header: currentHeader || 'Pasted Sequence',
            rawSequence: currentLines.join('\n')
          });
        }
        sawHeader = true;
        currentHeader = trimmedLine.slice(1).trim() || 'Sequence ' + (records.length + 1);
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    if (sawHeader || currentLines.length > 0) {
      records.push({
        index: records.length,
        header: currentHeader || 'Pasted Sequence',
        rawSequence: currentLines.join('\n')
      });
    }

    return records;
  }

  /**
   * Computes net charge at a given pH using the EMBOSS pKa set.
   * Derived strictly from amino-acid counts in O(1).
   */
  function computeNetCharge(counts, pH) {
    const pka = getConstants().EMBOSS_PKA;
    let charge = 0;

    // N-terminus (+1) and C-terminus (-1)
    charge += 1 / (1 + Math.pow(10, pH - pka.nTerm));
    charge -= 1 / (1 + Math.pow(10, pka.cTerm - pH));

    // Positively charged side chains: K, R, H
    const posKeys = Object.keys(pka.positive);
    for (let i = 0; i < posKeys.length; i++) {
      const aa = posKeys[i];
      const n = counts[aa] || 0;
      if (n > 0) {
        charge += n / (1 + Math.pow(10, pH - pka.positive[aa]));
      }
    }

    // Negatively charged side chains: D, E, C, Y
    const negKeys = Object.keys(pka.negative);
    for (let i = 0; i < negKeys.length; i++) {
      const aa = negKeys[i];
      const n = counts[aa] || 0;
      if (n > 0) {
        charge -= n / (1 + Math.pow(10, pka.negative[aa] - pH));
      }
    }

    return charge;
  }

  /**
   * Finds the isoelectric point (pI) via bisection on [0, 14].
   * Net charge is strictly monotonically decreasing with pH.
   */
  function computeIsoelectricPoint(counts) {
    let low = 0.0;
    let high = 14.0;

    // 70 iterations gives precision ~1e-20
    for (let i = 0; i < 70; i++) {
      const mid = (low + high) * 0.5;
      const charge = computeNetCharge(counts, mid);
      if (charge > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return (low + high) * 0.5;
  }

  /**
   * Aggregates counts and percentages by a grouping model key in O(20).
   */
  function computeGroupBreakdown(counts, validLength, modelKey) {
    const models = getConstants().GROUPING_MODELS;
    const model = models[modelKey] || models.sideChain;
    const groups = [];

    for (let i = 0; i < model.groups.length; i++) {
      const g = model.groups[i];
      let count = 0;
      for (let j = 0; j < g.residues.length; j++) {
        count += counts[g.residues[j]] || 0;
      }
      groups.push({
        id: g.id,
        label: g.label,
        residues: g.residues.slice(),
        color: g.color,
        count: count,
        percent: validLength > 0 ? (count / validLength) * 100 : 0
      });
    }

    return {
      modelId: model.id,
      modelLabel: model.label,
      modelDescription: model.description,
      groups: groups
    };
  }

  /**
   * Cleans, validates, and analyzes a single protein sequence record in a single O(n) pass.
   */
  function analyzeRecord(record, options) {
    const opts = options || {};
    const pH = typeof opts.pH === 'number' && Number.isFinite(opts.pH) ? opts.pH : 7.0;
    const C = getConstants();
    const aaTable = C.AMINO_ACIDS;
    const standardAAs = C.STANDARD_AAS;
    const raw = record && typeof record.rawSequence === 'string' ? record.rawSequence : '';

    // Initialize counts for all 20 standard amino acids
    const counts = {};
    for (let i = 0; i < standardAAs.length; i++) {
      counts[standardAAs[i]] = 0;
    }

    const excludedCounts = {};
    let excludedTotal = 0;
    const validChars = [];

    // Single O(n) pass: strip whitespace and digits, uppercase, classify valid vs excluded
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      // Strip whitespace, line breaks, and digits
      if (
        ch === ' ' ||
        ch === '\t' ||
        ch === '\n' ||
        ch === '\r' ||
        ch === '\v' ||
        ch === '\f' ||
        (ch >= '0' && ch <= '9')
      ) {
        continue;
      }

      const upper = ch.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(aaTable, upper)) {
        counts[upper] += 1;
        validChars.push(upper);
      } else {
        excludedCounts[upper] = (excludedCounts[upper] || 0) + 1;
        excludedTotal += 1;
      }
    }

    const validLength = validChars.length;
    const excludedList = Object.keys(excludedCounts)
      .sort()
      .map(function (ch) {
        return {
          char: ch,
          count: excludedCounts[ch],
          description: C.KNOWN_AMBIGUOUS_CODES[ch] || 'Non-standard / invalid character'
        };
      });

    if (validLength === 0) {
      return {
        ok: false,
        errorCode: excludedTotal > 0 ? 'ALL_INVALID' : 'EMPTY',
        errorMessage:
          excludedTotal > 0
            ? 'No standard amino acids (ACDEFGHIKLMNPQRSTVWY) were found. All ' +
              excludedTotal +
              ' non-whitespace characters were excluded.'
            : 'Please paste a protein sequence, upload a FASTA/text file, or select an example protein.',
        header: record ? record.header : '',
        excludedTotal: excludedTotal,
        excludedList: excludedList
      };
    }

    if (validLength < 2) {
      return {
        ok: false,
        errorCode: 'TOO_SHORT',
        errorMessage:
          'Sequence is too short (' +
          validLength +
          ' valid residue). Enter at least 2 standard amino acids to analyze a polypeptide.',
        header: record ? record.header : '',
        validLength: validLength,
        excludedTotal: excludedTotal,
        excludedList: excludedList
      };
    }

    const validSequence = validChars.join('');

    // Derive composition, MW, GRAVY, aliphatic index strictly from the 20 counts
    let residueMassSum = 0;
    let kdSum = 0;
    const composition = [];

    for (let i = 0; i < standardAAs.length; i++) {
      const code = standardAAs[i];
      const info = aaTable[code];
      const count = counts[code];
      const percent = (count / validLength) * 100;

      residueMassSum += count * info.mass;
      kdSum += count * info.kd;

      composition.push({
        code: code,
        three: info.three,
        name: info.name,
        count: count,
        percent: percent,
        mass: info.mass,
        kd: info.kd
      });
    }

    const molecularWeight = residueMassSum + C.WATER_MASS_DA;
    const gravy = kdSum / validLength;

    const xA = (counts.A / validLength) * 100;
    const xV = (counts.V / validLength) * 100;
    const xI = (counts.I / validLength) * 100;
    const xL = (counts.L / validLength) * 100;
    const aliphaticIndex = xA + 2.9 * xV + 3.9 * (xI + xL);

    const pI = computeIsoelectricPoint(counts);
    const netCharge = computeNetCharge(counts, pH);

    return {
      ok: true,
      header: record ? record.header : 'Pasted Sequence',
      validSequence: validSequence,
      validLength: validLength,
      excludedTotal: excludedTotal,
      excludedList: excludedList,
      counts: counts,
      composition: composition,
      molecularWeight: molecularWeight,
      pI: pI,
      pH: pH,
      netCharge: netCharge,
      gravy: gravy,
      aliphaticIndex: aliphaticIndex
    };
  }

  /**
   * Computes Kyte-Doolittle sliding-window profile in O(n) via running sum,
   * and downsamples to <= maxPoints using peak-preserving min/max bucketing.
   */
  function computeHydrophobicityProfile(sequence, requestedWindow, maxPoints) {
    const len = sequence ? sequence.length : 0;
    const maxPts = maxPoints || 2000;
    const reqWin = Math.max(5, Math.min(21, Math.round(requestedWindow || 9)));

    if (len < 2) {
      return {
        positions: [],
        values: [],
        totalWindows: 0,
        plottedPoints: 0,
        downsampled: false,
        requestedWindow: reqWin,
        effectiveWindow: 0,
        wasClamped: false
      };
    }

    const wasClamped = len < reqWin;
    const win = wasClamped ? len : reqWin;
    const kdTable = getConstants().AMINO_ACIDS;
    const totalWindows = len - win + 1;
    const halfOffset = (win - 1) * 0.5;

    // O(n) running sum for window averages
    const windowMeans = new Float64Array(totalWindows);
    let runningSum = 0;
    for (let i = 0; i < win; i++) {
      runningSum += kdTable[sequence[i]].kd;
    }
    windowMeans[0] = runningSum / win;

    for (let start = 1; start < totalWindows; start++) {
      runningSum += kdTable[sequence[start + win - 1]].kd - kdTable[sequence[start - 1]].kd;
      windowMeans[start] = runningSum / win;
    }

    if (totalWindows <= maxPts) {
      const positions = new Array(totalWindows);
      const values = new Array(totalWindows);
      for (let i = 0; i < totalWindows; i++) {
        positions[i] = Math.round(i + 1 + halfOffset);
        values[i] = Number(windowMeans[i].toFixed(4));
      }
      return {
        positions: positions,
        values: values,
        totalWindows: totalWindows,
        plottedPoints: totalWindows,
        downsampled: false,
        requestedWindow: reqWin,
        effectiveWindow: win,
        wasClamped: wasClamped
      };
    }

    // Peak-preserving min/max bucketing to stay <= maxPts (2 points per bucket)
    const bucketCount = Math.floor(maxPts / 2);
    const positions = [];
    const values = [];

    for (let b = 0; b < bucketCount; b++) {
      const bStart = Math.floor((b * totalWindows) / bucketCount);
      const bEnd = Math.min(totalWindows, Math.floor(((b + 1) * totalWindows) / bucketCount));
      if (bStart >= bEnd) continue;

      let minIdx = bStart;
      let maxIdx = bStart;
      let minVal = windowMeans[bStart];
      let maxVal = windowMeans[bStart];

      for (let j = bStart + 1; j < bEnd; j++) {
        const v = windowMeans[j];
        if (v < minVal) {
          minVal = v;
          minIdx = j;
        }
        if (v > maxVal) {
          maxVal = v;
          maxIdx = j;
        }
      }

      if (minIdx === maxIdx) {
        positions.push(Math.round(minIdx + 1 + halfOffset));
        values.push(Number(minVal.toFixed(4)));
      } else if (minIdx < maxIdx) {
        positions.push(Math.round(minIdx + 1 + halfOffset));
        values.push(Number(minVal.toFixed(4)));
        positions.push(Math.round(maxIdx + 1 + halfOffset));
        values.push(Number(maxVal.toFixed(4)));
      } else {
        positions.push(Math.round(maxIdx + 1 + halfOffset));
        values.push(Number(maxVal.toFixed(4)));
        positions.push(Math.round(minIdx + 1 + halfOffset));
        values.push(Number(minVal.toFixed(4)));
      }
    }

    return {
      positions: positions,
      values: values,
      totalWindows: totalWindows,
      plottedPoints: positions.length,
      downsampled: true,
      requestedWindow: reqWin,
      effectiveWindow: win,
      wasClamped: wasClamped
    };
  }

  /**
   * Builds a clean CSV string for downloading analysis results.
   */
  function exportAnalysisToCsv(analysis, groupBreakdown) {
    function csvEscape(val) {
      const str = String(val == null ? '' : val);
      if (/[",\n\r]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    const lines = [];
    lines.push('Protein Sequence Analyzer Report');
    lines.push(['Sequence Header', analysis.header].map(csvEscape).join(','));
    lines.push(['Valid Residues (aa)', analysis.validLength].map(csvEscape).join(','));
    lines.push(['Excluded Characters', analysis.excludedTotal].map(csvEscape).join(','));
    lines.push(['Molecular Weight (Da)', analysis.molecularWeight.toFixed(4)].map(csvEscape).join(','));
    lines.push(['Isoelectric Point (pI, EMBOSS pKa)', analysis.pI.toFixed(4)].map(csvEscape).join(','));
    lines.push(['Net Charge at pH ' + analysis.pH.toFixed(2), analysis.netCharge.toFixed(4)].map(csvEscape).join(','));
    lines.push(['GRAVY (Kyte-Doolittle)', analysis.gravy.toFixed(4)].map(csvEscape).join(','));
    lines.push(['Aliphatic Index', analysis.aliphaticIndex.toFixed(4)].map(csvEscape).join(','));
    lines.push('');

    if (groupBreakdown) {
      lines.push(['Group Breakdown Model', groupBreakdown.modelLabel].map(csvEscape).join(','));
      lines.push('Group,Residues,Count,Percentage (%)');
      for (let i = 0; i < groupBreakdown.groups.length; i++) {
        const g = groupBreakdown.groups[i];
        lines.push(
          [g.label, g.residues.join(' '), g.count, g.percent.toFixed(2)].map(csvEscape).join(',')
        );
      }
      lines.push('');
    }

    lines.push('Amino Acid Composition');
    lines.push('1-Letter,3-Letter,Name,Count,Percentage (%),Residue Mass (Da),Kyte-Doolittle');
    for (let i = 0; i < analysis.composition.length; i++) {
      const r = analysis.composition[i];
      lines.push(
        [
          r.code,
          r.three,
          r.name,
          r.count,
          r.percent.toFixed(4),
          r.mass.toFixed(4),
          r.kd.toFixed(1)
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    return lines.join('\r\n');
  }

  NS.Analyzer = {
    parseFastaRecords: parseFastaRecords,
    analyzeRecord: analyzeRecord,
    computeNetCharge: computeNetCharge,
    computeIsoelectricPoint: computeIsoelectricPoint,
    computeGroupBreakdown: computeGroupBreakdown,
    computeHydrophobicityProfile: computeHydrophobicityProfile,
    exportAnalysisToCsv: exportAnalysisToCsv
  };
})(window);
