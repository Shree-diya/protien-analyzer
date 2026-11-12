(function (global) {
  'use strict';

  const NS = (global.ProteinAnalyzer = global.ProteinAnalyzer || {});

  const STANDARD_AAS = 'ACDEFGHIKLMNPQRSTVWY'.split('');
  const STANDARD_AA_SET = new Set(STANDARD_AAS);

  // Ambiguous / non-standard single-letter codes recognized for clear reporting
  const KNOWN_AMBIGUOUS_CODES = {
    B: 'Aspartic acid or Asparagine (Asx)',
    Z: 'Glutamic acid or Glutamine (Glx)',
    J: 'Leucine or Isoleucine (Xle)',
    X: 'Unknown / any amino acid (Xaa)',
    U: 'Selenocysteine (Sec)',
    O: 'Pyrrolysine (Pyl)',
    '*': 'Translation stop'
  };

  const AMINO_ACIDS = {
    A: { code: 'A', three: 'Ala', name: 'Alanine', mass: 71.0788, kd: 1.8 },
    C: { code: 'C', three: 'Cys', name: 'Cysteine', mass: 103.1388, kd: 2.5 },
    D: { code: 'D', three: 'Asp', name: 'Aspartic acid', mass: 115.0886, kd: -3.5 },
    E: { code: 'E', three: 'Glu', name: 'Glutamic acid', mass: 129.1155, kd: -3.5 },
    F: { code: 'F', three: 'Phe', name: 'Phenylalanine', mass: 147.1766, kd: 2.8 },
    G: { code: 'G', three: 'Gly', name: 'Glycine', mass: 57.0519, kd: -0.4 },
    H: { code: 'H', three: 'His', name: 'Histidine', mass: 137.1411, kd: -3.2 },
    I: { code: 'I', three: 'Ile', name: 'Isoleucine', mass: 113.1594, kd: 4.5 },
    K: { code: 'K', three: 'Lys', name: 'Lysine', mass: 128.1741, kd: -3.9 },
    L: { code: 'L', three: 'Leu', name: 'Leucine', mass: 113.1594, kd: 3.8 },
    M: { code: 'M', three: 'Met', name: 'Methionine', mass: 131.1926, kd: 1.9 },
    N: { code: 'N', three: 'Asn', name: 'Asparagine', mass: 114.1038, kd: -3.5 },
    P: { code: 'P', three: 'Pro', name: 'Proline', mass: 97.1167, kd: -1.6 },
    Q: { code: 'Q', three: 'Gln', name: 'Glutamine', mass: 128.1307, kd: -3.5 },
    R: { code: 'R', three: 'Arg', name: 'Arginine', mass: 156.1875, kd: -4.5 },
    S: { code: 'S', three: 'Ser', name: 'Serine', mass: 87.0782, kd: -0.8 },
    T: { code: 'T', three: 'Thr', name: 'Threonine', mass: 101.1051, kd: -0.7 },
    V: { code: 'V', three: 'Val', name: 'Valine', mass: 99.1326, kd: 4.2 },
    W: { code: 'W', three: 'Trp', name: 'Tryptophan', mass: 186.2132, kd: -0.9 },
    Y: { code: 'Y', three: 'Tyr', name: 'Tyrosine', mass: 163.1760, kd: -1.3 }
  };

  // Water mass added once per polypeptide chain (Da)
  const WATER_MASS_DA = 18.01524;

  // EMBOSS pKa set specified in the project spec
  const EMBOSS_PKA = {
    nTerm: 8.6,
    cTerm: 3.6,
    positive: {
      K: 10.8,
      R: 12.5,
      H: 6.5
    },
    negative: {
      D: 3.9,
      E: 4.1,
      C: 8.5,
      Y: 10.1
    }
  };

  // Single config object for switchable amino-acid grouping models & consistent colors
  const GROUPING_MODELS = {
    sideChain: {
      id: 'sideChain',
      label: 'Side-chain property',
      description: 'Classifies residues by chemical polarity and charge at physiological pH.',
      groups: [
        {
          id: 'hydrophobic',
          label: 'Hydrophobic',
          residues: ['A', 'V', 'L', 'I', 'M', 'F', 'W', 'P'],
          color: '#f59e0b'
        },
        {
          id: 'polarUncharged',
          label: 'Polar uncharged',
          residues: ['S', 'T', 'N', 'Q', 'C', 'Y', 'G'],
          color: '#10b981'
        },
        {
          id: 'positive',
          label: 'Positive (basic)',
          residues: ['K', 'R', 'H'],
          color: '#3b82f6'
        },
        {
          id: 'negative',
          label: 'Negative (acidic)',
          residues: ['D', 'E'],
          color: '#ef4444'
        }
      ]
    },
    size: {
      id: 'size',
      label: 'Size',
      description: 'Groups residues by side-chain steric volume (small, medium, large).',
      groups: [
        {
          id: 'small',
          label: 'Small',
          residues: ['G', 'A', 'S', 'C', 'T', 'P', 'D', 'N', 'V'],
          color: '#06b6d4'
        },
        {
          id: 'medium',
          label: 'Medium',
          residues: ['E', 'Q', 'H', 'M', 'I', 'L', 'K', 'R'],
          color: '#8b5cf6'
        },
        {
          id: 'large',
          label: 'Large',
          residues: ['F', 'W', 'Y'],
          color: '#ec4899'
        }
      ]
    },
    structureFunction: {
      id: 'structureFunction',
      label: 'Structure / function',
      description: 'Separates aromatic, sulfur-containing, aliphatic, acidic, basic, and other polar/special residues.',
      groups: [
        {
          id: 'aromatic',
          label: 'Aromatic',
          residues: ['F', 'W', 'Y'],
          color: '#ec4899'
        },
        {
          id: 'sulfur',
          label: 'Sulfur-containing',
          residues: ['C', 'M'],
          color: '#eab308'
        },
        {
          id: 'aliphatic',
          label: 'Aliphatic',
          residues: ['A', 'V', 'L', 'I'],
          color: '#f97316'
        },
        {
          id: 'acidic',
          label: 'Acidic',
          residues: ['D', 'E'],
          color: '#ef4444'
        },
        {
          id: 'basic',
          label: 'Basic',
          residues: ['K', 'R', 'H'],
          color: '#3b82f6'
        },
        {
          id: 'other',
          label: 'Other (G, N, P, Q, S, T)',
          residues: ['G', 'N', 'P', 'Q', 'S', 'T'],
          color: '#14b8a6'
        }
      ]
    }
  };

  // Precompute residue -> group lookup per model for O(1) coloring/aggregation
  const RESIDUE_GROUP_LOOKUP = {};
  Object.keys(GROUPING_MODELS).forEach(function (modelKey) {
    const map = {};
    GROUPING_MODELS[modelKey].groups.forEach(function (group) {
      group.residues.forEach(function (aa) {
        map[aa] = group;
      });
    });
    RESIDUE_GROUP_LOOKUP[modelKey] = map;
  });

  // Deterministic pseudo-random sequence generator for the 35,000-residue benchmark demo
  function generateLongBenchmarkSequence(length) {
    const len = length || 35000;
    const chars = STANDARD_AAS;
    const out = new Array(len);
    let seed = 133742;
    for (let i = 0; i < len; i++) {
      // Mulberry32-style deterministic step
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      out[i] = chars[Math.floor(r * chars.length)];
    }
    return out.join('');
  }

  const EXAMPLE_PROTEINS = [
    {
      id: 'insulin-a',
      name: 'Human Insulin A Chain (21 aa)',
      pdbId: '',
      uniprotId: 'P01308',
      fasta: '>Human_Insulin_A_chain | 21 aa\nGIVEQCCTSICSLYQLENYCN'
    },
    {
      id: 'insulin-b',
      name: 'Human Insulin B Chain (30 aa)',
      pdbId: '',
      uniprotId: 'P01308',
      fasta: '>Human_Insulin_B_chain | 30 aa\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT'
    },
    {
      id: 'ubiquitin',
      name: 'Ubiquitin (76 aa, PDB 1UBQ)',
      pdbId: '1UBQ',
      uniprotId: 'P0CG48',
      fasta:
        '>Ubiquitin_Homo_sapiens | PDB:1UBQ | 76 aa\n' +
        'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYN\n' +
        'IQKESTLHLVLRLRGG'
    },
    {
      id: 'gfp',
      name: 'GFP (238 aa, PDB 1EMA)',
      pdbId: '1EMA',
      uniprotId: 'P42212',
      fasta:
        '>GFP_Aequorea_victoria | Ref_PDB:1EMA | 238 aa\n' +
        'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTL\n' +
        'VTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLV\n' +
        'NRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLAD\n' +
        'HYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK'
    },
    {
      id: 'long-35k',
      name: 'Long Chain Stress Demo (35,000 aa)',
      pdbId: '',
      uniprotId: '',
      getFasta: function () {
        const seq = generateLongBenchmarkSequence(35000);
        // Format in 80-char FASTA lines
        const lines = ['>Synthetic_Long_Chain_Benchmark | 35,000 aa (Titin-scale performance test)'];
        for (let i = 0; i < seq.length; i += 80) {
          lines.push(seq.slice(i, i + 80));
        }
        return lines.join('\n');
      }
    }
  ];

  NS.Constants = {
    STANDARD_AAS: STANDARD_AAS,
    STANDARD_AA_SET: STANDARD_AA_SET,
    KNOWN_AMBIGUOUS_CODES: KNOWN_AMBIGUOUS_CODES,
    AMINO_ACIDS: AMINO_ACIDS,
    WATER_MASS_DA: WATER_MASS_DA,
    EMBOSS_PKA: EMBOSS_PKA,
    GROUPING_MODELS: GROUPING_MODELS,
    RESIDUE_GROUP_LOOKUP: RESIDUE_GROUP_LOOKUP,
    EXAMPLE_PROTEINS: EXAMPLE_PROTEINS,
    generateLongBenchmarkSequence: generateLongBenchmarkSequence
  };
})(window);
