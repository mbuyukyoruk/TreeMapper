# Examples

The home page's examples open these sessions. Each `<id>.js` registers one saved
session on `window.TM_EXAMPLES`. Using a script rather than a JSON file lets it load both from the
web and from a page opened as a local file. The layer files each session was built from are in
`data/<id>/`, so you can open them yourself or swap in your own.

## Reverse transcriptases (`rt-references`)

A maximum-likelihood tree of the RT domains of **1,077 reference reverse transcriptases**: 1,065
labelled in the six studies below, plus 12 structure anchors (11 PDB entries and one NCBI protein,
WP_040120558.1, a putative DRT11). Most belong to bacterial RT families (UG/Abi 593, Retron 203,
group II intron 111, CRISPR-associated RT 70, DGR 38); the 62 in eight smaller families include
eukaryotic retroelement and telomerase RTs (LTR/Retroviral/YR, non-LTR, PLE, TERT). It is shown
in the circular layout:

- **Branches coloured by RT family** (clade groups, `family.csv`). The five large families use
  Okabe–Ito colours, which stay distinguishable with colour-vision deficiency; the eight small
  ones use quiet blue-greys.
- **Rings:**
  - RT family (`family_ring.csv`)
  - **defense-associated RTs (DRT1–DRT11) and Abi RTs** (AbiA, AbiK, AbiP2) only (`defense.csv`)
  - the **source study** (`source.csv`)
  - each protein's **domain layout**: N-terminal region, RT domain, C-terminal region (`domains.tsv`)
  - **protein length** in amino acids (`length.csv`)

**Tree:**
- IQ-TREE 3, model Q.PFAM+G4 (chosen by BIC).
- 2,279 aligned positions, 1,319 of them parsimony-informative.
- **No branch-support values** were computed (no bootstrap or SH-aLRT), so the tree shows topology
  only.

**RT domains:** boundaries from an RT-core profile (959 proteins) or Pfam RVT_1 (118). Eight
domains are shorter than 150 amino acids (partial).

| Source | Study |
|---|---|
| Mestre 2022 | Mestre MR, Gao LA, Shah SA, et al. UG/Abi: a highly diverse family of prokaryotic reverse transcriptases associated with defense functions. *Nucleic Acids Res* 2022. doi:10.1093/nar/gkac467 |
| Mestre 2020 | Mestre MR, González-Delgado A, Gutiérrez-Rus LI, et al. Systematic prediction of genes functionally associated with bacterial retrons and classification of the encoded tripartite systems. *Nucleic Acids Res* 2020. doi:10.1093/nar/gkaa1149 |
| Toro 2014 | Toro N, Nisa-Martínez R. Comprehensive phylogenetic analysis of bacterial reverse transcriptases. *PLoS One* 2014. doi:10.1371/journal.pone.0114083 |
| Toro 2018 | Toro N, Martínez-Abarca F, González-Delgado A, et al. On the origin and evolutionary relationships of the reverse transcriptases associated with type III CRISPR-Cas systems. *Front Microbiol* 2018. doi:10.3389/fmicb.2018.01317 |
| Wu 2018 | Wu L, Gingery M, Abebe M, et al. Diversity-generating retroelements: natural variation, classification and evolution inferred from a large-scale genomic survey. *Nucleic Acids Res* 2018. doi:10.1093/nar/gkx1150 |
| Tang 2025 | Tang S, Žedaveinytė R, Burman N, et al. Protein-primed homopolymer synthesis by an antiviral reverse transcriptase. *Nature* 2025. doi:10.1038/s41586-025-09179-5 |

**How it was made:** the labels and tree come from the Wiedenheft Lab's RT classification reference
set. They were converted by `TreeMapper_tests/examples-build/build_rt_example.py`, then loaded in
TreeMapper and saved as a session.

## CRISPR-Cas loci, mock data (`mock`)

**Invented data** (56 tips, accessions `MOCK_*`), structured like real data so the example looks
plausible, in the rectangular layout:
- a tree of four clades, one per CRISPR-Cas subtype: Type I-F, I-E, III-A and II-A (`tree.nwk`)
- **clade groups**: the subtype (`clade.csv`)
- a **dataframe** of each tip's *cas* locus, genes in the subtype's order with typical lengths
  (Type I-F with the *cas2/3* fusion), some loci on the reverse strand (`dataframe.tsv`); the
  CRISPR array is not drawn, as it is not a gene
- **highlights**: the phylum, shared by related tips (`highlight.csv`)
- a numeric **heatmap**: GC content around each phylum's typical value (`heatmap.csv`)
- a **bar chart**: the number of spacers (`chart.csv`)

**How it was made:** `TreeMapper_tests/examples-build/build_mock.py` writes the layer files; they
were loaded in TreeMapper, saved as a session, given a palette (`palette_mock.py`: genes by role)
and packed with `pack_example.py`.

**To replace it:** build your session in TreeMapper, save it (**Save session**), then run
`python3 TreeMapper_tests/examples-build/pack_example.py <your.treemapper> mock "Your title" TreeMapper/examples`.
Update the example's card on the home page (`index.html`, `#tmHome`).

## The home page

The home page draws the reverse transcriptase example as TreeMapper draws it, from
`js/home-figure.js` (written by `TreeMapper_tests/examples-build/rt_home_figure.js` from the
rendered workspace, in both themes). Its picture of the mock example is the workspace itself
(`img/home/mock-light.jpg`, `mock-dark.jpg`, from `examples-build/home_shots.js`). Run both again
after changing an example.
