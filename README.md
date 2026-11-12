# Protein Sequence Analyzer

A client-side protein sequence analysis and visualization tool.

**Live app:** https://shree-diya.github.io/protien-analyzer/

## Features

- Analyze raw protein sequences and FASTA input, including multi-FASTA records and uploaded files.
- View amino-acid composition, molecular weight, isoelectric point, GRAVY, and hydropathy profiles.
- Explore amino-acid grouping models and residue-by-residue 3D formation simulation.
- Load experimental structures from RCSB PDB, AlphaFold DB, or predict short sequences with ESMFold.
- Export analysis results as CSV and switch between light and dark themes.

## Run locally

Open `index.html` in a modern browser. The app loads Chart.js, Three.js, and 3Dmol.js from public CDNs, so an internet connection is needed for those libraries and online structure services.