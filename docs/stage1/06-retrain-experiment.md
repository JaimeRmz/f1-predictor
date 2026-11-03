# Stage 1 follow-up A: does retraining on more recent data help? (walk-forward experiment)

Read-only. Throwaway models only; **no production model, artifact, data file, workflow or Supabase object was touched**, and nothing here was saved to `backend/`. Scripts: `analysis/16_retrain_walkforward.py` (the experiment), `analysis/17_retrain_normalised.py` (the level-versus-ranking check). Outputs: `analysis/out/retrain_*.json|csv`.

## 1. Bottom line

**Retraining on more recent data does not help in any way that matters. Do not retrain on this evidence.**

- **Ranking does not reliably improve.** With the real grid it is equal or **worse**: Spearman is significantly lower for four of the five variants (for example recent-seasons-only -0.044 [-0.069, -0.018], with winner hit 44.2% vs 60.5%). With the predicted grid some point estimates are slightly higher (expanding window: winner hit +4.7 points [0.0, +11.6]; top-3 overlap +0.05 to +0.16) but **every interval includes or just touches zero**, and Spearman is flat or lower.
- **The Brier scores do improve, but that is an artefact of score level.** Retrained models, especially those trained on fewer or recency-weighted rows, simply output *lower* scores (their per-race win sums drop from 2.86 to as low as 1.62), which is less over-confidence, not better discrimination. When every variant's scores are rescaled per race to sum to 1 and 3 (the Part 1B rescale), **almost all of the advantage disappears** (nearly every interval includes zero), and recent-seasons-only becomes significantly *worse* on the predicted-grid path in 2026.
- **A plain per-race rescale of the unchanged production model beats any retrain on raw Brier.** Production rescaled: win 0.0317, podium 0.0665 (real grid); the best retrained raw variant (recent-only) is 0.0383 and 0.0714.
- **The 2026 regulation change does not rescue it.** Models that see the first 2026 races as they happen (V1) are no better on later 2026 races (Brier win -0.0009 [-0.0033, +0.0012]; ranking unchanged).

## 2. Design (fixed before looking at results)

For **each of the 43 out-of-sample races** (2025 and 2026 rounds 1-19), models are trained **only on races strictly before it**, so every prediction is genuinely out of sample. Features are the master's, which Part 1B verified are computable from earlier races only. Three models are retrained per race and variant (podium, winner, qualifying regressor), so the predicted-grid path is retrained end to end. Hyperparameters are **production's, read from the committed pickles, not tuned**; the winner model's `scale_pos_weight` is recomputed per training set as the notebook derived it.

| variant | training data for a given target race |
|---|---|
| V0 production | trained once on year <= 2024 (the Part 1B rows, not retrained) |
| **V1 expanding** | every race since 2010 before the target race |
| **V2 recent only** | 2022 onward (the ground-effect era) before the target race |
| **V3 expanding, recency weights** | every race since 2010, sample weight 0.5 ** ((target year - year) / 3), a **half-life of 3 seasons chosen in advance** |
| V3a, V3b | sensitivity only: half-lives 1.5 and 6 seasons; **reported, never selected** |

Both Part 1B conditions run through the repo's own code in-process: (a) real grid via `predict_race`; (b) predicted grid via `whatif_predict(auto_quali=True)` with data and lookups rebuilt from only the earlier races. Metrics and bootstrap-by-race intervals are as in Part 1B; every difference is **paired** against production.

**Control (verified):** at the first race (2025 round 1) the expanding window is trained on exactly the 6,436 rows production used, and its predictions are **identical to production's, to 0.0 difference, in both conditions** (same grid, same win and podium scores). So the retraining harness reproduces the production pipeline exactly; differences below are due to the data, not the machinery.

Training rows per race (min to max): V1 and the V3 family 6,436 to 7,311; V2 1,359 to 2,234.

## 3. Results

Intervals are 95% bootstrap-by-race. "Change vs production" is the paired difference; for Brier, **negative is better**.

### 3.1 Real grid, condition (a)

**(a) real grid, all 43 races, 897 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0617 [0.0551, 0.0682] | 0.0870 [0.0783, 0.0963] | 2.86 / 5.17 | 60.5% | 2.16 | 0.661 | reference |
| V1 expanding window | 0.0595 [0.0531, 0.0661] | 0.0852 [0.0769, 0.0943] | 2.75 / 5.03 | 60.5% | 2.09 | 0.649 | -0.0022 [-0.0049, +0.0002]; -0.0018 [-0.0036, -0.0001]; -0.012 [-0.022, -0.004] |
| V2 recent seasons only (2022+) | 0.0383 [0.0305, 0.0462] | 0.0714 [0.0610, 0.0824] | 1.62 / 4.12 | 44.2% | 2.09 | 0.617 | -0.0234 [-0.0305, -0.0164]; -0.0157 [-0.0222, -0.0089]; -0.044 [-0.069, -0.018] |
| V3 expanding, recency weights (half-life 3) | 0.0536 [0.0467, 0.0607] | 0.0801 [0.0712, 0.0897] | 2.54 / 4.78 | 53.5% | 2.14 | 0.643 | -0.0082 [-0.0123, -0.0038]; -0.0069 [-0.0107, -0.0031]; -0.018 [-0.032, -0.005] |
| V3a half-life 1.5 (sensitivity) | 0.0462 [0.0382, 0.0542] | 0.0754 [0.0663, 0.0850] | 2.18 / 4.52 | 51.2% | 2.14 | 0.626 | -0.0156 [-0.0210, -0.0100]; -0.0117 [-0.0168, -0.0061]; -0.035 [-0.056, -0.014] |
| V3b half-life 6 (sensitivity) | 0.0595 [0.0524, 0.0666] | 0.0829 [0.0745, 0.0921] | 2.74 / 4.93 | 55.8% | 2.14 | 0.651 | -0.0022 [-0.0057, +0.0012]; -0.0041 [-0.0069, -0.0013]; -0.009 [-0.019, +0.000] |

**(a) real grid, 2025 (24 races), 479 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0709 [0.0646, 0.0775] | 0.0842 [0.0714, 0.0973] | 3.00 / 5.05 | 50.0% | 2.29 | 0.643 | reference |
| V1 expanding window | 0.0676 [0.0602, 0.0751] | 0.0810 [0.0691, 0.0933] | 2.83 / 4.82 | 58.3% | 2.21 | 0.625 | -0.0033 [-0.0081, +0.0007]; -0.0032 [-0.0056, -0.0009]; -0.018 [-0.036, -0.006] |
| V2 recent seasons only (2022+) | 0.0417 [0.0319, 0.0518] | 0.0703 [0.0569, 0.0840] | 1.71 / 4.07 | 45.8% | 2.12 | 0.595 | -0.0292 [-0.0387, -0.0191]; -0.0139 [-0.0221, -0.0051]; -0.048 [-0.085, -0.010] |
| V3 expanding, recency weights (half-life 3) | 0.0614 [0.0542, 0.0686] | 0.0784 [0.0663, 0.0912] | 2.66 / 4.68 | 45.8% | 2.21 | 0.624 | -0.0095 [-0.0152, -0.0035]; -0.0058 [-0.0110, -0.0010]; -0.019 [-0.040, +0.001] |
| V3a half-life 1.5 (sensitivity) | 0.0531 [0.0430, 0.0627] | 0.0728 [0.0617, 0.0844] | 2.36 / 4.47 | 45.8% | 2.21 | 0.621 | -0.0178 [-0.0252, -0.0098]; -0.0114 [-0.0178, -0.0046]; -0.022 [-0.050, +0.008] |
| V3b half-life 6 (sensitivity) | 0.0693 [0.0612, 0.0770] | 0.0795 [0.0680, 0.0918] | 2.86 / 4.79 | 54.2% | 2.25 | 0.632 | -0.0016 [-0.0075, +0.0036]; -0.0047 [-0.0083, -0.0012]; -0.011 [-0.026, +0.004] |

**(a) real grid, 2026 R1-19 (19 races), 418 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0513 [0.0423, 0.0610] | 0.0903 [0.0782, 0.1029] | 2.70 / 5.32 | 73.7% | 2.00 | 0.683 | reference |
| V1 expanding window | 0.0503 [0.0415, 0.0600] | 0.0901 [0.0784, 0.1021] | 2.65 / 5.29 | 63.2% | 1.95 | 0.680 | -0.0009 [-0.0033, +0.0012]; -0.0002 [-0.0025, +0.0021]; -0.003 [-0.011, +0.003] |
| V2 recent seasons only (2022+) | 0.0344 [0.0227, 0.0467] | 0.0726 [0.0562, 0.0893] | 1.51 / 4.19 | 42.1% | 2.05 | 0.644 | -0.0168 [-0.0263, -0.0078]; -0.0177 [-0.0280, -0.0071]; -0.039 [-0.073, -0.004] |
| V3 expanding, recency weights (half-life 3) | 0.0446 [0.0345, 0.0559] | 0.0820 [0.0687, 0.0955] | 2.39 / 4.92 | 63.2% | 2.05 | 0.666 | -0.0067 [-0.0129, -0.0004]; -0.0083 [-0.0139, -0.0022]; -0.017 [-0.036, -0.000] |
| V3a half-life 1.5 (sensitivity) | 0.0382 [0.0273, 0.0502] | 0.0783 [0.0633, 0.0938] | 1.95 / 4.57 | 57.9% | 2.05 | 0.631 | -0.0130 [-0.0204, -0.0053]; -0.0120 [-0.0203, -0.0030]; -0.052 [-0.083, -0.027] |
| V3b half-life 6 (sensitivity) | 0.0483 [0.0387, 0.0586] | 0.0868 [0.0742, 0.0997] | 2.58 / 5.12 | 57.9% | 2.00 | 0.676 | -0.0029 [-0.0070, +0.0007]; -0.0035 [-0.0076, +0.0012]; -0.007 [-0.018, +0.004] |

### 3.2 Predicted grid, condition (b) (the path forecasts and snapshots use)

**(b) predicted qualifying, all 43 races, 892 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0887 [0.0796, 0.0980] | 0.1133 [0.1019, 0.1257] | 2.98 / 5.23 | 20.9% | 1.60 | 0.585 | reference |
| V1 expanding window | 0.0857 [0.0758, 0.0955] | 0.1094 [0.0987, 0.1218] | 2.88 / 5.12 | 25.6% | 1.65 | 0.583 | -0.0030 [-0.0071, +0.0008]; -0.0039 [-0.0078, -0.0002]; -0.001 [-0.012, +0.009] |
| V2 recent seasons only (2022+) | 0.0651 [0.0552, 0.0748] | 0.1043 [0.0915, 0.1185] | 1.71 / 4.24 | 23.3% | 1.74 | 0.557 | -0.0236 [-0.0329, -0.0145]; -0.0090 [-0.0186, +0.0005]; -0.028 [-0.060, +0.003] |
| V3 expanding, recency weights (half-life 3) | 0.0756 [0.0653, 0.0857] | 0.1074 [0.0959, 0.1206] | 2.54 / 4.77 | 20.9% | 1.65 | 0.571 | -0.0131 [-0.0194, -0.0069]; -0.0059 [-0.0126, +0.0005]; -0.013 [-0.031, +0.006] |
| V3a half-life 1.5 (sensitivity) | 0.0692 [0.0598, 0.0786] | 0.1083 [0.0967, 0.1216] | 2.09 / 4.46 | 27.9% | 1.67 | 0.561 | -0.0195 [-0.0273, -0.0117]; -0.0050 [-0.0141, +0.0039]; -0.023 [-0.048, +0.002] |
| V3b half-life 6 (sensitivity) | 0.0818 [0.0721, 0.0915] | 0.1089 [0.0980, 0.1212] | 2.79 / 4.96 | 25.6% | 1.77 | 0.579 | -0.0069 [-0.0113, -0.0026]; -0.0044 [-0.0095, +0.0007]; -0.006 [-0.022, +0.009] |

**(b) predicted qualifying, 2025 (24 races), 476 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0941 [0.0837, 0.1044] | 0.1082 [0.0899, 0.1267] | 3.09 / 5.16 | 12.5% | 1.75 | 0.540 | reference |
| V1 expanding window | 0.0897 [0.0778, 0.1020] | 0.1044 [0.0878, 0.1217] | 3.02 / 5.04 | 20.8% | 1.79 | 0.537 | -0.0044 [-0.0111, +0.0016]; -0.0038 [-0.0090, +0.0013]; -0.003 [-0.018, +0.012] |
| V2 recent seasons only (2022+) | 0.0617 [0.0500, 0.0743] | 0.0950 [0.0758, 0.1157] | 1.78 / 4.33 | 25.0% | 2.00 | 0.524 | -0.0323 [-0.0459, -0.0189]; -0.0132 [-0.0256, -0.0006]; -0.016 [-0.055, +0.023] |
| V3 expanding, recency weights (half-life 3) | 0.0781 [0.0671, 0.0899] | 0.1008 [0.0837, 0.1189] | 2.60 / 4.78 | 8.3% | 1.83 | 0.542 | -0.0159 [-0.0263, -0.0055]; -0.0074 [-0.0169, +0.0018]; +0.002 [-0.025, +0.031] |
| V3a half-life 1.5 (sensitivity) | 0.0704 [0.0587, 0.0829] | 0.1034 [0.0850, 0.1229] | 2.21 / 4.55 | 29.2% | 1.83 | 0.543 | -0.0236 [-0.0353, -0.0120]; -0.0048 [-0.0182, +0.0086]; +0.003 [-0.032, +0.039] |
| V3b half-life 6 (sensitivity) | 0.0844 [0.0746, 0.0947] | 0.1034 [0.0866, 0.1208] | 2.90 / 4.93 | 20.8% | 1.96 | 0.544 | -0.0097 [-0.0163, -0.0029]; -0.0048 [-0.0122, +0.0023]; +0.004 [-0.021, +0.028] |

**(b) predicted qualifying, 2026 R1-19 (19 races), 416 driver-races**

| variant | Brier win | Brier podium | win sum / podium sum | winner hit | top-3 overlap | Spearman | change vs production: Brier win; Brier podium; Spearman |
|---|---|---|---|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0826 [0.0677, 0.0981] | 0.1192 [0.1064, 0.1332] | 2.84 / 5.32 | 31.6% | 1.42 | 0.641 | reference |
| V1 expanding window | 0.0812 [0.0651, 0.0972] | 0.1151 [0.1015, 0.1299] | 2.72 / 5.21 | 31.6% | 1.47 | 0.641 | -0.0014 [-0.0058, +0.0029]; -0.0040 [-0.0099, +0.0015]; +0.000 [-0.016, +0.015] |
| V2 recent seasons only (2022+) | 0.0689 [0.0525, 0.0843] | 0.1149 [0.0985, 0.1312] | 1.63 / 4.13 | 21.1% | 1.42 | 0.598 | -0.0137 [-0.0252, -0.0015]; -0.0042 [-0.0191, +0.0096]; -0.043 [-0.090, +0.008] |
| V3 expanding, recency weights (half-life 3) | 0.0727 [0.0558, 0.0899] | 0.1150 [0.0997, 0.1311] | 2.47 / 4.75 | 36.8% | 1.42 | 0.609 | -0.0099 [-0.0164, -0.0039]; -0.0042 [-0.0139, +0.0047]; -0.032 [-0.050, -0.014] |
| V3a half-life 1.5 (sensitivity) | 0.0678 [0.0528, 0.0822] | 0.1140 [0.0987, 0.1298] | 1.94 / 4.34 | 26.3% | 1.47 | 0.585 | -0.0148 [-0.0248, -0.0047]; -0.0051 [-0.0173, +0.0058]; -0.057 [-0.083, -0.030] |
| V3b half-life 6 (sensitivity) | 0.0789 [0.0620, 0.0960] | 0.1152 [0.1010, 0.1296] | 2.66 / 5.00 | 31.6% | 1.53 | 0.623 | -0.0037 [-0.0085, +0.0015]; -0.0039 [-0.0117, +0.0031]; -0.018 [-0.031, -0.005] |

### 3.3 Is it ranking or just score level? Brier after rescaling every variant per race

**This is a post-hoc diagnostic**: I added it after seeing the raw results, to explain them; the experiment's variants and metrics (section 2) were fixed beforehand. The raw tables show lower Brier for retrained variants *together with lower score sums*. Rescaling each race's scores to sum to 1 (win) and 3 (podium) removes that level effect and tests whether the *ranking and shape* improved.

**(a) real grid, all 43 races**

| variant, scores rescaled per race to sum 1 / 3 | Brier win | Brier podium | change vs rescaled production: win; podium |
|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0317 | 0.0665 | reference |
| V1 expanding window | 0.0317 | 0.0666 | +0.0000 [-0.0006, +0.0006]; +0.0001 [-0.0009, +0.0013] |
| V2 recent seasons only (2022+) | 0.0286 | 0.0616 | -0.0031 [-0.0070, +0.0010]; -0.0049 [-0.0095, -0.0003] |
| V3 expanding, recency weights (half-life 3) | 0.0306 | 0.0648 | -0.0011 [-0.0022, +0.0001]; -0.0017 [-0.0037, +0.0003] |
| V3a half-life 1.5 (sensitivity) | 0.0296 | 0.0631 | -0.0021 [-0.0044, +0.0002]; -0.0034 [-0.0065, -0.0003] |
| V3b half-life 6 (sensitivity) | 0.0314 | 0.0658 | -0.0002 [-0.0010, +0.0006]; -0.0007 [-0.0021, +0.0008] |

**(b) predicted qualifying, all 43 races**

| variant, scores rescaled per race to sum 1 / 3 | Brier win | Brier podium | change vs rescaled production: win; podium |
|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0396 | 0.0805 | reference |
| V1 expanding window | 0.0389 | 0.0794 | -0.0007 [-0.0021, +0.0006]; -0.0011 [-0.0032, +0.0010] |
| V2 recent seasons only (2022+) | 0.0448 | 0.0844 | +0.0052 [-0.0001, +0.0106]; +0.0038 [-0.0030, +0.0107] |
| V3 expanding, recency weights (half-life 3) | 0.0389 | 0.0815 | -0.0007 [-0.0032, +0.0018]; +0.0009 [-0.0033, +0.0050] |
| V3a half-life 1.5 (sensitivity) | 0.0419 | 0.0851 | +0.0023 [-0.0017, +0.0063]; +0.0046 [-0.0014, +0.0107] |
| V3b half-life 6 (sensitivity) | 0.0387 | 0.0806 | -0.0009 [-0.0023, +0.0004]; +0.0000 [-0.0032, +0.0031] |

**(b) predicted qualifying, 2026 R1-19 (19)**

| variant, scores rescaled per race to sum 1 / 3 | Brier win | Brier podium | change vs rescaled production: win; podium |
|---|---|---|---|
| V0 production (trained once on year <= 2024) | 0.0392 | 0.0830 | reference |
| V1 expanding window | 0.0392 | 0.0816 | +0.0000 [-0.0017, +0.0017]; -0.0013 [-0.0047, +0.0019] |
| V2 recent seasons only (2022+) | 0.0476 | 0.0935 | +0.0085 [+0.0018, +0.0149]; +0.0105 [+0.0001, +0.0209] |
| V3 expanding, recency weights (half-life 3) | 0.0381 | 0.0860 | -0.0011 [-0.0040, +0.0016]; +0.0031 [-0.0029, +0.0092] |
| V3a half-life 1.5 (sensitivity) | 0.0422 | 0.0902 | +0.0031 [-0.0028, +0.0088]; +0.0072 [-0.0013, +0.0154] |
| V3b half-life 6 (sensitivity) | 0.0386 | 0.0836 | -0.0006 [-0.0024, +0.0014]; +0.0006 [-0.0040, +0.0049] |

**Reading it.**
- **Real grid:** after rescaling, V1 is identical to production (+0.0000 win), and the recency variants keep only small gains whose intervals mostly include zero (V2 podium -0.0049 [-0.0095, -0.0003] is the one that does not, and it comes with worse ranking).
- **Predicted grid:** after rescaling, no variant is clearly better; recent-only is **worse** (+0.0052 win, interval touching zero, over all 43; +0.0085 [+0.0018, +0.0149] in 2026).
- **Interpretation:** retraining mainly changes how *confident* the scores are. That is something a rescale or a calibrator fixes cheaply (Part 1B), and the production model's *ranking* is not improved by newer data.

## 4. The 2026 rule change

2026 is a new technical-regulation era, so one might expect old data to hurt and fresh data to help. What this experiment can and cannot say:
- It tests the realistic version: V1 and V3 see 2026 races only as they happen (by round 19 that is 18 races, about 5-6% of the unweighted training rows), and V2 trains on 2022 onward.
- **On 2026 races, V1 is no better than production** (real grid: Brier win -0.0009 [-0.0033, +0.0012], Spearman -0.003; predicted grid: unchanged). Recency weighting lowers raw Brier in 2026 about as much as in 2025 (V3: -0.0067 vs -0.0095 real grid), which fits the level-shift explanation rather than a regulation-specific gain; ranking in 2026 is lower for V3 and V2 (Spearman -0.017 and -0.039 real grid).
- **Limits:** the new-regime sample is small and grows slowly, the hyperparameters were fixed for roughly 6,400 rows (recent-only trains on 1,400-2,200 rows, which plausibly explains its shrunken scores and worse ranking), and I did not retune them. A retuned recent-era model, or one that adds a regime feature, is a different experiment and is not tested.

## 5. What this means

- **Do not schedule retraining as a way to improve accuracy.** On 43 out-of-sample races, newer data neither improved the model's ordering of drivers nor, once score level is accounted for, its Brier score. That agrees with Part 1B, which found that the binding weakness is the predicted grid and the miscalibrated level, not the age of the training data.
- **The cheap fixes remain better:** per-race rescaling (or a calibrator) for the level; a better grid input (Part 1C) for the ranking.
- If you retrain for other reasons (for example to include 2026 once the season is over), do it as the deliberate, versioned, human-approved step in `05`; the harness here (control passes) can be reused to compare any candidate against production before approving it.

## 6. Verified and not verified

**Verified:** the harness reproduces production exactly at the control race (0.0 difference); every retrain used only earlier races; hyperparameters were production's; the variants and the half-life were fixed before the results; production rows are the unchanged Part 1B rows; all differences are paired with by-race intervals; the rescaling check uses the same rescale as Part 1B.
**Not verified / limits:** 43 races (24 and 19 per year) and wide intervals; hyperparameters were not retuned for smaller or recency-weighted training sets; one primary half-life (3) plus two sensitivity values; the winner model's `scale_pos_weight` was recomputed per training set (the notebook's rule) and not tested separately; retraining each model on a different feature set, a regime flag, or more trees was not tried; feature quality for 2026 relies on the data as ingested (the Qatar NULL grid is patched in memory as in Part 1B, since the data fix is on an unmerged branch).

## 7. Reproduce

```
python analysis/16_retrain_walkforward.py     # about 8 minutes; SMOKE=1 runs a 2-race wiring check
python analysis/17_retrain_normalised.py      # the rescaling check
```
