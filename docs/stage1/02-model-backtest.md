# Stage 1, Part 1B: out-of-sample backtest of the production model

Branch `docs/stage1-audit`. Read-only audit: no app code, data file or model artifact was modified, nothing was retrained for production, and nothing touched Supabase, Render or f1predictor.app. Every number below is reproducible with the scripts in `analysis/` (see the last section).

## 1. Bottom line

All figures are for **43 races** (24 in 2025, 19 in 2026 rounds 1-19; 897 driver-races with the real grid, 892 on the predicted-qualifying path). 95% intervals are bootstrap-by-race. With 43 races the intervals are wide, and I say so wherever a difference is not clear.

1. **As served, the probabilities are not usable as probabilities.** Per race, win scores sum to 2.86 on average (range 1.92-3.81) and podium scores to 5.17 (4.20-5.99) with the real grid; 2.98 and 5.23 on the path the snapshot job uses. They should sum to 1 and 3. Calibration is poor in both directions of confidence: at predicted 0.9-1.0 the win rate actually observed is 0.58 (real grid) and 0.23 (predicted grid).
2. **Raw win probabilities are worse than a constant.** Brier for win: model 0.0617 vs always-predict-1/n 0.0456 (model worse by 0.016, CI +0.010 to +0.022). For podium the model is better than the constant with the real grid (0.0870 vs 0.1231) but **not distinguishable from it on the predicted-grid path** (0.1133 vs 0.1236; difference -0.010, CI -0.022 to +0.002).
3. **Ranking quality with the real grid is good but is mostly the grid.** The model beats "top 3 by pre-race standings" clearly (winner hit 60.5% vs 27.9%; top-3 overlap 2.16 vs 1.74 of 3), but it is **statistically level with a one-line baseline that only reads the grid** (hit 60.5% vs 67.4%, difference -7pp, CI -19 to +5; overlap 2.16 vs 2.07; Spearman 0.66 vs 0.66).
4. **On the path the site and snapshots actually use (predicted qualifying), the model does not beat pre-race standings.** Winner hit 20.9% (9/43) vs 27.9% for the standings leader (model minus baseline -7pp, CI -16 to 0); top-3 overlap 1.60 vs 1.74 (CI -0.35 to +0.07); Spearman 0.58 vs 0.61 (n.s.). Brier is clearly worse (win +0.050, podium +0.033, both CIs exclude 0).
5. **The main cause of the gap between conditions is the predicted grid, not stale features.** The quali model's grid has Spearman 0.74 against the real grid and names the pole-sitter in 7 of 43 races (16%; chance is about 5%). Replacing the production path's stale features with fresh point-in-time ones, while keeping the predicted grid, barely changes Brier (win -0.003, CI -0.009 to +0.003).
6. **Cheap post-processing fixes most of the probability problem, but does not create skill.** Just rescaling each race's scores to sum to 1 (win) and 3 (podium) cuts Brier by 48% (win) and 24% (podium) with the real grid and by 55% / 29% on the predicted grid. Calibrated versions reach about 0.027 win / 0.059 podium Brier with the real grid, which is **level with "historical win/podium rate by grid rank"** (0.0258 / 0.0607), not better. On the predicted-grid path, normalised scores are level with the standings-rank prior (0.0396 vs 0.0389 win; 0.0805 vs 0.0805 podium).
7. **Data defect found:** `results.csv` has `grid` = NULL for all 20 drivers of the **2025 Qatar GP (raceId 1167)**, which the app turns into grid 0 for everyone. Patched in memory only for this audit (effect on conclusions: none, Brier moves <0.001). The data file is untouched; this belongs in the Part 1D validation checks.

## 2. Verified findings vs assumptions

**Verified (by code reading and by running it):**
- Models trained on `year <= 2024` (the notebook's train/test split), so 2025-26 is out of sample for the production artifacts. I retrained nothing for production; the throwaway models in section 5 are separate and are used only to fit calibrators.
- **Point-in-time check (`analysis/01_pit_check.py`).** I recomputed every model input for every 2025-26 driver-race from the raw CSVs using only strictly earlier races, with a deliberately naive "filter to earlier races, then aggregate" loop, independent of the notebook's `shift`/`rolling` code, and compared with `data/f1_master.csv`.
  - Race model, 8 non-grid features: **897 rows, 43 races, 0 mismatches** (max difference 4e-15). `grid` is the real grid by definition.
  - Quali model, 6 aggregate features: **0 mismatches**.
  - So the master's stored features do not leak future results by construction. The constructor-level leak fix described in the notebook is present and works.
- The deployed `/whatif` path (what snapshots use) does **not** use those entering-the-race values. It takes each driver's *latest row as stored* (features as they stood entering that driver's *previous* race) plus `lookups.pkl`, whose "last value" entries are the same one-race-stale numbers. I reproduced this by calling the repo's own `main.whatif_predict` with `df` and lookups rebuilt from only the races before each race. Section 6 measures how much the staleness matters (very little).
- The inference-time circuit lookups include the current season (weight 0.75), while training used strictly earlier years. Same direction, small, and not separately measured here.

**Assumptions / not verified:**
- Results are today's final classifications, not what was known on the day. Appeals reclassified some earlier races (Monaco twice, per the brief), so a "pre-race as of then" replay could differ slightly from this one. Not measured.
- The notebook repeatedly reports metrics on 2025+ while the features and hyperparameters were being developed, so some **test-set reuse** is plausible. I cannot see how many iterations there were, so I cannot size it. If it is real, the true out-of-sample numbers are somewhat worse than the ones here.
- The 2026 technical regulations are a regime change the model never saw. I do not separate "regime change" from "model is weak"; the 2025 and 2026 splits are shown but each has only 19-24 races.
- In the backtest the entry list is the drivers who actually raced. Production derives it ("raced at least 2 of the last 3 rounds"), which can differ.

## 3. Method

**Races:** every 2025 race and 2026 rounds 1-19 (43 races, 897 driver-races). **Conditions** (both call the repo's own code in-process, no HTTP):

| | what it is | how run |
|---|---|---|
| (a) real grid | `main.predict_race(raceId)`: master-row features, actual grid | the production `/predict` path |
| (b) predicted qualifying | `main.whatif_predict(..., auto_quali=True)` | the path snapshots use; `df` and all lookups rebuilt from only the races before each race |

In (b) the production path cannot predict drivers with no history: 5 driver-races (Antonelli, Bortoleto, Hadjar at 2025 R1; Lindblad at 2026 R1; Hirakawa at 2026 R19). They finished 4th, 16th, 20th, 8th and 13th, so none won or podiumed; they are excluded from (b) only.

**Metrics:** Brier and log loss (probabilities clipped to [1e-4, 1-1e-4]) for win and podium, pooled over driver-races; 10-bin reliability; per-race probability sums; winner hit rate = the driver with the highest `win_probability`; top-3 overlap = how many of the model's top 3 (by `podium_probability`) finished on the podium; Spearman between predicted order and finishing order, averaged over races. **Intervals:** 5,000 bootstrap resamples of whole races; paired differences use the same resamples. Chance level for a random ordering: winner hit 4.8%, top-3 overlap 0.43.

**Baselines:**
- *Standings*: order by championship points entering the race (previous round's published standings; previous season's final standings at round 1).
- *Constructor strength*: order by the team's pre-race constructor standing, ties by driver standing.
- *Grid*: order by grid (real grid in (a); the model's own predicted grid in (b)).
- *Constant base rate*: win = 1/n, podium = 3/n.
- The first three give an ordering. To compare **Brier**, each also gets a probabilistic form: the historical frequency of winning / podiuming by rank, estimated from **2010-2024 only** (the same era the model trained on). In (b) the grid baseline uses the real-grid priors on predicted-grid ranks, so it is deliberately weak; standings is the fair comparator there.

## 4. Results

### 4.1 Real grid, condition (a): 43 races, 897 driver-races

| method | Brier win | Brier podium | winner hit | top-3 overlap (of 3) | Spearman |
|---|---|---|---|---|---|
| **model (raw)** | 0.0617 [0.056, 0.068] | 0.0870 [0.078, 0.096] | 60.5% [46.5, 74.4] | 2.16 [1.95, 2.35] | 0.66 [0.61, 0.71] |
| constant base rate | 0.0456 [0.045, 0.046] | 0.1231 [0.122, 0.125] | n/a | n/a | n/a |
| standings (rank prior) | 0.0387 [0.035, 0.043] | 0.0801 [0.073, 0.088] | 27.9% [14.0, 41.9] | 1.74 [1.56, 1.93] | 0.60 [0.55, 0.65] |
| constructor strength | 0.0401 [0.035, 0.045] | 0.0866 [0.078, 0.095] | 30.2% [16.3, 44.2] | 1.56 [1.35, 1.77] | 0.59 [0.53, 0.65] |
| grid (rank prior) | **0.0258** [0.021, 0.031] | **0.0607** [0.052, 0.070] | 67.4% [53.5, 81.4] | 2.07 [1.86, 2.28] | 0.66 [0.60, 0.71] |

Model minus baseline, paired (95% CI; a difference is clear only if the interval excludes 0):

| vs | Brier win | Brier podium | winner hit | top-3 overlap | Spearman |
|---|---|---|---|---|---|
| constant base rate | +0.016 [+0.010, +0.022] (worse) | -0.036 [-0.045, -0.027] (better) | | | |
| standings | +0.023 [+0.016, +0.030] (worse) | +0.007 [-0.002, +0.016] (n.s.) | +33pp [+14, +51] (better) | +0.42 [+0.21, +0.65] (better) | +0.056 [+0.021, +0.093] (better) |
| constructor | +0.022 [+0.015, +0.029] (worse) | +0.000 [-0.009, +0.010] (n.s.) | +30pp [+12, +49] (better) | +0.60 [+0.37, +0.84] (better) | +0.068 [+0.034, +0.102] (better) |
| grid | +0.036 [+0.031, +0.041] (worse) | +0.026 [+0.020, +0.033] (worse) | -7pp [-19, +5] (n.s.) | +0.09 [-0.05, +0.23] (n.s.) | +0.005 [-0.022, +0.032] (n.s.) |

By year (model only): 2025 (24 races) Brier win 0.0709 / podium 0.0842, winner hit 50.0% [29, 71]; 2026 (19 races) 0.0513 / 0.0903, 73.7% [53, 90]. The two years' intervals overlap on most metrics; I would not read a trend into 19-24 races.

### 4.2 Predicted qualifying, condition (b): 43 races, 892 driver-races

| method | Brier win | Brier podium | winner hit | top-3 overlap | Spearman |
|---|---|---|---|---|---|
| **model (raw)** | 0.0887 [0.079, 0.098] | 0.1133 [0.102, 0.125] | 20.9% [9.3, 32.6] | 1.60 [1.40, 1.81] | 0.58 [0.52, 0.64] |
| constant base rate | 0.0459 [0.045, 0.047] | 0.1236 [0.122, 0.125] | n/a | n/a | n/a |
| standings (rank prior) | **0.0389** [0.035, 0.043] | **0.0805** [0.073, 0.088] | 27.9% [16.3, 41.9] | 1.74 [1.56, 1.93] | 0.61 [0.55, 0.66] |
| constructor strength | 0.0403 [0.036, 0.045] | 0.0871 [0.079, 0.096] | 30.2% [16.3, 44.2] | 1.56 [1.35, 1.77] | 0.59 [0.53, 0.65] |
| predicted-grid order | 0.0462 [0.041, 0.051] | 0.0895 [0.079, 0.100] | 18.6% [7.0, 30.2] | 1.56 [1.35, 1.77] | 0.60 [0.53, 0.66] |

Model minus baseline, paired:

| vs | Brier win | Brier podium | winner hit | top-3 overlap | Spearman |
|---|---|---|---|---|---|
| constant base rate | +0.043 [+0.034, +0.052] (worse) | -0.010 [-0.022, +0.002] (n.s.) | | | |
| standings | +0.050 [+0.043, +0.057] (worse) | +0.033 [+0.024, +0.042] (worse) | -7pp [-16, 0] (borderline worse) | -0.14 [-0.35, +0.07] (n.s.) | -0.022 [-0.060, +0.012] (n.s.) |
| constructor | +0.048 [+0.041, +0.056] (worse) | +0.026 [+0.017, +0.036] (worse) | -9pp [-19, -2] (worse) | +0.05 [-0.14, +0.23] (n.s.) | -0.005 [-0.035, +0.022] (n.s.) |

**Plain answer to "does the model beat the baselines?"**
- *Real grid:* it beats the standings and constructor baselines on ranking, because it uses the grid. It does not beat a baseline that only reads the grid, and its raw probabilities are worse than that baseline's on Brier.
- *Predicted qualifying (the path used for snapshots and the Next Race page):* no. It is level with pre-race standings on ranking at best (point estimates slightly worse, intervals include 0) and clearly worse on Brier. This matches the earlier observation on the three genuine foresight snapshots, now with a larger sample.

### 4.3 Probability sums per race (what "should be 1 and 3" looks like)

| condition | win sum: mean (min-max) | podium sum: mean (min-max) | races |
|---|---|---|---|
| (a) real grid | 2.86 (1.92-3.81) | 5.17 (4.20-5.99) | 43 |
| (b) predicted quali | 2.98 (2.29-3.91) | 5.23 (4.14-5.85) | 43 |

Per-race values: `analysis/out/backtest_sums_*.csv`.

### 4.4 Reliability (10 equal-width bins, pooled), with n and 95% intervals for every bin

`n` = driver-races in the bin, `events` = wins (or podiums) among them, `races` = how many of the 43 races contribute to the bin. Two intervals for the observed rate: **Wilson** (treats driver-races as independent) and **by-race bootstrap** (resamples whole races; the more honest one when a bin's rows cluster in a few races). Where a bin has 0 events the bootstrap collapses to [0.000, 0.000] and says nothing about uncertainty; use the Wilson interval there.

**(a) real grid, win probability** (897 driver-races, 43 races)

| bin | n | events | races | mean pred | observed | Wilson 95% | by-race bootstrap 95% |
|---|---|---|---|---|---|---|---|
| 0.0-0.1 | 680 | 1 | 43 | 0.008 | 0.001 | [0.000, 0.008] | [0.000, 0.004] |
| 0.1-0.2 | 34 | 1 | 28 | 0.143 | 0.029 | [0.005, 0.149] | [0.000, 0.100] |
| 0.2-0.3 | 34 | 1 | 25 | 0.247 | 0.029 | [0.005, 0.149] | [0.000, 0.094] |
| 0.3-0.4 | 20 | 0 | 16 | 0.355 | 0.000 | [0.000, 0.161] | [0.000, 0.000] |
| 0.4-0.5 | 21 | 0 | 17 | 0.450 | 0.000 | [0.000, 0.155] | [0.000, 0.000] |
| 0.5-0.6 | 9 | 0 | 8 | 0.570 | 0.000 | [0.000, 0.299] | [0.000, 0.000] |
| 0.6-0.7 | 14 | 3 | 12 | 0.660 | 0.214 | [0.076, 0.476] | [0.000, 0.429] |
| 0.7-0.8 | 23 | 6 | 21 | 0.760 | 0.261 | [0.125, 0.465] | [0.087, 0.458] |
| 0.8-0.9 | 29 | 12 | 23 | 0.863 | 0.414 | [0.255, 0.593] | [0.250, 0.591] |
| 0.9-1.0 | 33 | 19 | 28 | 0.938 | 0.576 | [0.408, 0.728] | [0.433, 0.724] |

**(a) real grid, podium probability** (897 driver-races, 43 races)

| bin | n | events | races | mean pred | observed | Wilson 95% | by-race bootstrap 95% |
|---|---|---|---|---|---|---|---|
| 0.0-0.1 | 560 | 2 | 43 | 0.019 | 0.004 | [0.001, 0.013] | [0.000, 0.009] |
| 0.1-0.2 | 43 | 0 | 27 | 0.146 | 0.000 | [0.000, 0.082] | [0.000, 0.000] |
| 0.2-0.3 | 28 | 2 | 22 | 0.253 | 0.071 | [0.020, 0.226] | [0.000, 0.179] |
| 0.3-0.4 | 18 | 4 | 17 | 0.338 | 0.222 | [0.090, 0.452] | [0.056, 0.412] |
| 0.4-0.5 | 21 | 3 | 18 | 0.446 | 0.143 | [0.050, 0.346] | [0.000, 0.304] |
| 0.5-0.6 | 18 | 2 | 15 | 0.556 | 0.111 | [0.031, 0.328] | [0.000, 0.286] |
| 0.6-0.7 | 40 | 10 | 27 | 0.655 | 0.250 | [0.142, 0.402] | [0.108, 0.388] |
| 0.7-0.8 | 40 | 15 | 29 | 0.746 | 0.375 | [0.242, 0.530] | [0.237, 0.500] |
| 0.8-0.9 | 50 | 25 | 34 | 0.853 | 0.500 | [0.366, 0.634] | [0.389, 0.608] |
| 0.9-1.0 | 79 | 66 | 43 | 0.941 | 0.835 | [0.739, 0.901] | [0.756, 0.911] |

**(b) predicted quali, win probability** (892 driver-races, 43 races)

| bin | n | events | races | mean pred | observed | Wilson 95% | by-race bootstrap 95% |
|---|---|---|---|---|---|---|---|
| 0.0-0.1 | 679 | 4 | 43 | 0.007 | 0.006 | [0.002, 0.015] | [0.001, 0.012] |
| 0.1-0.2 | 28 | 3 | 26 | 0.148 | 0.107 | [0.037, 0.272] | [0.000, 0.240] |
| 0.2-0.3 | 24 | 3 | 18 | 0.240 | 0.125 | [0.043, 0.310] | [0.000, 0.280] |
| 0.3-0.4 | 17 | 2 | 13 | 0.337 | 0.118 | [0.033, 0.343] | [0.000, 0.294] |
| 0.4-0.5 | 14 | 1 | 13 | 0.447 | 0.071 | [0.013, 0.315] | [0.000, 0.250] |
| 0.5-0.6 | 24 | 5 | 20 | 0.537 | 0.208 | [0.092, 0.405] | [0.056, 0.375] |
| 0.6-0.7 | 17 | 1 | 16 | 0.643 | 0.059 | [0.010, 0.270] | [0.000, 0.200] |
| 0.7-0.8 | 18 | 6 | 15 | 0.753 | 0.333 | [0.163, 0.563] | [0.120, 0.577] |
| 0.8-0.9 | 28 | 8 | 22 | 0.838 | 0.286 | [0.153, 0.471] | [0.143, 0.423] |
| 0.9-1.0 | 43 | 10 | 37 | 0.940 | 0.233 | [0.132, 0.377] | [0.116, 0.349] |

**(b) predicted quali, podium probability** (892 driver-races, 43 races)

| bin | n | events | races | mean pred | observed | Wilson 95% | by-race bootstrap 95% |
|---|---|---|---|---|---|---|---|
| 0.0-0.1 | 557 | 6 | 43 | 0.018 | 0.011 | [0.005, 0.023] | [0.004, 0.020] |
| 0.1-0.2 | 46 | 5 | 30 | 0.145 | 0.109 | [0.047, 0.230] | [0.026, 0.196] |
| 0.2-0.3 | 19 | 0 | 15 | 0.253 | 0.000 | [0.000, 0.168] | [0.000, 0.000] |
| 0.3-0.4 | 20 | 3 | 16 | 0.344 | 0.150 | [0.052, 0.360] | [0.000, 0.350] |
| 0.4-0.5 | 16 | 4 | 15 | 0.456 | 0.250 | [0.102, 0.495] | [0.059, 0.500] |
| 0.5-0.6 | 26 | 6 | 22 | 0.549 | 0.231 | [0.110, 0.421] | [0.083, 0.371] |
| 0.6-0.7 | 30 | 12 | 22 | 0.648 | 0.400 | [0.246, 0.577] | [0.241, 0.567] |
| 0.7-0.8 | 42 | 18 | 32 | 0.754 | 0.429 | [0.291, 0.578] | [0.289, 0.575] |
| 0.8-0.9 | 47 | 21 | 35 | 0.849 | 0.447 | [0.314, 0.588] | [0.311, 0.586] |
| 0.9-1.0 | 89 | 54 | 43 | 0.945 | 0.607 | [0.503, 0.702] | [0.522, 0.694] |

**Reading it, with the intervals:**
- *Real grid:* the predicted value is **above the Wilson upper bound in 8 of 10 win bins and 9 of 10 podium bins**. The exceptions are win 0.0-0.2 (where the observed rate and prediction are both near zero) and podium 0.3-0.4 (n = 18).
- *Predicted qualifying:* the predicted value is above the Wilson upper bound in **6 of 10 bins for win and 6 of 10 for podium** (win 0.4-1.0; podium 0.2-0.3 and 0.5-1.0). The remaining low and middle bins are *consistent with* their predictions at this sample size, so I do not claim they are miscalibrated.
- **No bin in either condition is significantly under-predicted**: the model is never too timid, only too confident. This replaces my earlier, stronger wording that "every bin above 0.1" was below its prediction; with n between 9 and 50 per upper bin that was not supported for every bin.
- Single bins with n < 25 are weak evidence on their own (a bin of 20 with ~0 events has a Wilson upper bound near 0.16). The case rests on the pattern across the upper bins and on the Brier/ECE results, not on any one row.

### 4.5 How good is the predicted grid? (`analysis/04_grid_diagnostics.py`, 43 races)

Mean Spearman vs the real grid 0.74 (2025: 0.69, 2026: 0.80); pole-sitter named correctly in 7 of 43 races (16.3%); mean position error 3.2; top-3 grid overlap 1.58 of 3. This is the weakest link in the snapshot path.

### 4.6 Winner-hit rates, every figure with its sample size and intervals

The pick is the driver with the highest `win_probability` (ties: higher podium score, then better grid). Each race is one trial, so **n = races (43 overall, 24 in 2025, 19 in 2026)**. Wilson = binomial interval on races; bootstrap = resampling races. Chance for a random pick is about 4.8%.

| condition | scope | method | hits / races | rate | Wilson 95% | by-race bootstrap 95% |
|---|---|---|---|---|---|---|
| a_real_grid | all 43 | model (argmax win_probability) | 26 / 43 | 60.5% | [45.6, 73.6] | [46.5, 74.4] |
| a_real_grid | all 43 | pre-race standings leader | 12 / 43 | 27.9% | [16.7, 42.7] | [14.0, 41.9] |
| a_real_grid | all 43 | best constructor's top driver | 13 / 43 | 30.2% | [18.6, 45.1] | [16.3, 44.2] |
| a_real_grid | all 43 | grid leader (pole) | 29 / 43 | 67.4% | [52.5, 79.5] | [53.5, 81.4] |
| a_real_grid | 2025 (24) | model (argmax win_probability) | 12 / 24 | 50.0% | [31.4, 68.6] | [29.2, 70.8] |
| a_real_grid | 2025 (24) | pre-race standings leader | 5 / 24 | 20.8% | [9.2, 40.5] | [4.2, 37.5] |
| a_real_grid | 2025 (24) | best constructor's top driver | 6 / 24 | 25.0% | [12.0, 44.9] | [8.3, 41.7] |
| a_real_grid | 2025 (24) | grid leader (pole) | 16 / 24 | 66.7% | [46.7, 82.0] | [45.8, 83.3] |
| a_real_grid | 2026 R1-19 (19) | model (argmax win_probability) | 14 / 19 | 73.7% | [51.2, 88.2] | [52.6, 89.5] |
| a_real_grid | 2026 R1-19 (19) | pre-race standings leader | 7 / 19 | 36.8% | [19.1, 59.0] | [15.8, 57.9] |
| a_real_grid | 2026 R1-19 (19) | best constructor's top driver | 7 / 19 | 36.8% | [19.1, 59.0] | [15.8, 57.9] |
| a_real_grid | 2026 R1-19 (19) | grid leader (pole) | 13 / 19 | 68.4% | [46.0, 84.6] | [47.4, 89.5] |
| b_predicted_quali | all 43 | model (argmax win_probability) | 9 / 43 | 20.9% | [11.4, 35.2] | [9.3, 32.6] |
| b_predicted_quali | all 43 | pre-race standings leader | 12 / 43 | 27.9% | [16.7, 42.7] | [16.3, 41.9] |
| b_predicted_quali | all 43 | best constructor's top driver | 13 / 43 | 30.2% | [18.6, 45.1] | [16.3, 44.2] |
| b_predicted_quali | all 43 | grid leader (pole) | 8 / 43 | 18.6% | [9.7, 32.6] | [7.0, 30.2] |
| b_predicted_quali | 2025 (24) | model (argmax win_probability) | 3 / 24 | 12.5% | [4.3, 31.0] | [0.0, 29.2] |
| b_predicted_quali | 2025 (24) | pre-race standings leader | 5 / 24 | 20.8% | [9.2, 40.5] | [4.2, 37.5] |
| b_predicted_quali | 2025 (24) | best constructor's top driver | 6 / 24 | 25.0% | [12.0, 44.9] | [8.3, 41.7] |
| b_predicted_quali | 2025 (24) | grid leader (pole) | 3 / 24 | 12.5% | [4.3, 31.0] | [0.0, 29.2] |
| b_predicted_quali | 2026 R1-19 (19) | model (argmax win_probability) | 6 / 19 | 31.6% | [15.4, 54.0] | [10.5, 52.6] |
| b_predicted_quali | 2026 R1-19 (19) | pre-race standings leader | 7 / 19 | 36.8% | [19.1, 59.0] | [15.8, 57.9] |
| b_predicted_quali | 2026 R1-19 (19) | best constructor's top driver | 7 / 19 | 36.8% | [19.1, 59.0] | [15.8, 57.9] |
| b_predicted_quali | 2026 R1-19 (19) | grid leader (pole) | 5 / 19 | 26.3% | [11.8, 48.8] | [10.5, 47.4] |

With 19-24 races per year, the 95% intervals on any single rate are about 35-40 points wide, and even over all 43 races they are about 28 points wide. Differences between methods that look large in one year (for instance 2025 model 50.0% vs pole 66.7% on the real grid) are inside the noise.

## 5. Experiments (throwaway; nothing here is used by the app)

All on the same 43 races, intervals bootstrap-by-race (2,000 resamples). Difference columns are paired against the raw scores. "Cal" variants were fit on **2023-24 out-of-sample predictions (919 driver-races, 46 races) of throwaway XGBoost models trained only through 2022**, using the production hyperparameters, so no 2025-26 information touches any calibrator. The production artifacts were not used to fit anything. Section 5.5 explains exactly why that calibration data is out of sample, and tests whether the choice matters.

### 5.1 Real grid, condition (a)

| variant | Brier win | Brier podium | ECE win | ECE podium | win sum | podium sum | change vs raw (win / podium) |
|---|---|---|---|---|---|---|---|
| raw | 0.0617 | 0.0870 | 0.089 | 0.104 | 2.86 | 5.17 | |
| normalise to sum 1 / 3 | 0.0317 | 0.0665 | 0.024 | 0.052 | 1.00 | 3.00 | -0.030 [-0.035, -0.026] / -0.021 [-0.025, -0.017] |
| Platt (2023-24 fit) | 0.0280 | 0.0588 | 0.008 | 0.022 | 1.09 | 3.13 | -0.034 / -0.028 |
| isotonic (2023-24 fit) | 0.0297 | 0.0591 | 0.010 | 0.020 | 1.01 | 3.15 | -0.032 / -0.028 |
| Platt then normalise | 0.0270 | 0.0589 | 0.012 | 0.027 | 1.00 | 3.00 | -0.035 [-0.039, -0.031] / -0.028 [-0.032, -0.024] |
| Plackett-Luce, podium odds | 0.0281 | 0.0569 | 0.014 | 0.020 | 1.00 | 3.00 | -0.034 / -0.030 |
| *grid-rank prior (baseline)* | *0.0258* | *0.0607* | 0.016 | 0.021 | 1 | 3 | |
| *standings prior (baseline)* | *0.0387* | *0.0801* | 0.014 | 0.017 | 1 | 3 | |

Every calibration or normalisation variant improves Brier by an amount whose interval excludes 0. Against the grid-rank prior (paired): normalise only is still slightly worse on win (+0.006 [+0.002, +0.010]); Platt+normalise is level (win +0.001 [-0.002, +0.005], podium -0.002 [-0.007, +0.003]); Plackett-Luce is level (win +0.002, podium -0.004, both intervals include 0). **Calibration brings the model up to the grid-rank baseline; it does not go past it.** Winner hit, top-3 overlap and Spearman are unchanged by monotone calibration (ordering preserved).

### 5.2 Predicted qualifying, condition (b)

| variant | Brier win | Brier podium | ECE win | ECE podium | win sum | podium sum | change vs raw (win / podium) |
|---|---|---|---|---|---|---|---|
| raw | 0.0887 | 0.1133 | 0.095 | 0.108 | 2.98 | 5.23 | |
| **normalise to sum 1 / 3** | **0.0396** | **0.0805** | 0.010 | 0.015 | 1.00 | 3.00 | -0.049 [-0.056, -0.043] / -0.033 [-0.038, -0.027] |
| Platt (2023-24, real-grid fit) | 0.0479 | 0.0842 | 0.033 | 0.031 | 1.18 | 3.24 | -0.041 / -0.029 |
| isotonic (2023-24, real-grid fit) | 0.0493 | 0.0877 | 0.036 | 0.041 | 1.14 | 3.29 | -0.039 / -0.026 |
| Platt then normalise | 0.0444 | 0.0815 | 0.030 | 0.027 | 1.00 | 3.00 | -0.044 / -0.032 |
| Plackett-Luce, podium odds | 0.0423 | 0.0927 | 0.026 | 0.067 | 1.00 | 3.00 | -0.046 / -0.021 |
| fresh features + predicted grid | 0.0856 | 0.1114 | 0.094 | 0.108 | 2.95 | 5.23 | -0.003 [-0.009, +0.003] / -0.002 [-0.006, +0.002] |
| *standings prior (baseline)* | *0.0389* | *0.0805* | 0.014 | 0.017 | 1 | 3 | |
| *grid prior on predicted ranks (weak baseline)* | *0.0462* | *0.0895* | 0.031 | 0.043 | 1 | 3 | |

- Plain per-race normalisation is the best simple fix here, and it is **level with the standings prior** (paired difference win +0.001 [-0.002, +0.004], podium 0.000 [-0.006, +0.006]).
- Calibrators fitted on real-grid predictions do **not transfer** to the predicted-grid path (sums overshoot to 1.18 / 3.24): the two paths have different error profiles, so each would need its own calibrator.
- Isolating the cause: moving from real grid to predicted grid costs about +0.027 win Brier (0.0617 to 0.0887); giving the predicted-grid path fresh, correct features recovers only 0.003 of that. The loss is the grid, not the staleness.

### 5.3 Expanding-window calibration inside the replay (races 13-43 scored after a 12-race burn-in; 31 races: 658 rows in (a), 656 in (b))

| condition | raw Brier win / podium | normalise | expanding-window Platt | expanding-window isotonic |
|---|---|---|---|---|
| (a) real grid | 0.0570 / 0.0897 | 0.0303 / 0.0676 | 0.0267 / 0.0601 | 0.0305 / 0.0651 |
| (b) predicted quali | 0.0877 / 0.1206 | 0.0393 / 0.0842 | 0.0400 / 0.0879 | 0.0401 / 0.0912 |

Each calibrator is refit before every race using only the earlier races of the replay. With the predicted grid they land where plain normalisation does; with the real grid Platt is slightly better than normalising (0.0267 vs 0.0303 win), as in 5.1. With 12-30 races of training data, isotonic is noisier than Platt, as expected.

### 5.4 Plackett-Luce finishing-order simulation

Treating the scores as strengths and simulating finishing order (exact win probability; podium by 20,000 simulated races) gives probabilities that sum to exactly 1 and 3 by construction. Using the podium score's odds as strength is as good as the best calibrated variant with the real grid (win 0.0281, podium 0.0569). With the predicted grid it is worse than plain normalisation on podium (0.0927 vs 0.0805). The exponent on the strengths is a sensitivity sweep (square-root of the win score is shown in `analysis/out/experiments_results.json`), not a tuned choice; I did not select a winner on the test races. Retirements are not modelled, so this is not a DNF layer.

**Verdict on the three experiments:** each improves Brier with intervals excluding 0 and fixes the "sums to 3.0" problem. None of them makes the model better than the one-line rank baselines (grid with the real grid, standings with the predicted grid). What would add information is a better qualifying prediction, not more post-processing.

### 5.5 Where the calibration data came from (is it really out of sample?)

**The question.** The production models train on `year <= 2024`, so their predictions for 2023-24 are *in sample*: they were fit on those outcomes. They cannot honestly be used to fit a calibrator for later years.

**What was done (and what it is not).** The calibrators in 5.1-5.2 were fit on predictions for 2023-24 from **throwaway models trained only on `year <= 2022`** (`analysis/03_experiments.py`, `fit_through_2022`). For *those* models, 2023-24 is a **temporal holdout: out of sample for the model that scored it**. It is not cross-validation and it is not in-sample. The production artifacts were never used to produce calibration data in 5.1-5.2. Two limits remain: the calibrator is then applied to a *different* model (trained through 2024), and the sample is small (919 driver-races, 46 races).

**Does the choice change the result? No, by test** (`analysis/06_calibration_provenance.py`). I fit Platt and isotonic calibrators on three different calibration sets and scored all of them on the same 2025-26 real-grid production scores (43 races, 897 driver-races). The model-fit of each set:
- **V1** (used above): models trained through 2022, scoring 2023-24 (919 rows).
- **V2** (the leaky shortcut): the *production* models scoring 2023-24, which they were trained on (919 rows, in sample).
- **V3** (expanding-window time-series CV): for each year Y from 2015 to 2024, models trained on years < Y scoring Y, pooled (4219 rows, 209 races; every row is held out with respect to the model that scored it).

| calibration data and method | Brier win | Brier podium | mean sums (win / podium) | change vs V1-Platt (win / podium) |
|---|---|---|---|---|
| raw production scores | 0.0617 [0.0556, 0.0681] | 0.0870 [0.0781, 0.0962] | 2.86 / 5.17 | +0.0338 / +0.0282 |
| V1 holdout 2023-24 (models <=2022) | platt | 0.0280 [0.0237, 0.0325] | 0.0588 [0.0514, 0.0666] | 1.09 / 3.13 | reference |
| V1 holdout 2023-24 (models <=2022) | isotonic | 0.0297 [0.0254, 0.0343] | 0.0591 [0.0508, 0.0677] | 1.01 / 3.15 | +0.0017 [-0.0010, +0.0042] / +0.0002 [-0.0013, +0.0020] |
| V2 in-sample 2023-24 (production models) | platt | 0.0292 [0.0231, 0.0353] | 0.0586 [0.0488, 0.0687] | 1.01 / 3.17 | +0.0012 [-0.0008, +0.0032] / -0.0003 [-0.0030, +0.0025] |
| V2 in-sample 2023-24 (production models) | isotonic | 0.0288 [0.0235, 0.0343] | 0.0586 [0.0493, 0.0683] | 0.98 / 3.15 | +0.0008 [-0.0008, +0.0025] / -0.0002 [-0.0026, +0.0023] |
| V3 rolling-origin 2015-2024 | platt | 0.0286 [0.0251, 0.0322] | 0.0590 [0.0513, 0.0669] | 1.20 / 3.31 | +0.0006 [-0.0003, +0.0016] / +0.0002 [-0.0002, +0.0005] |
| V3 rolling-origin 2015-2024 | isotonic | 0.0292 [0.0258, 0.0328] | 0.0590 [0.0511, 0.0672] | 1.21 / 3.33 | +0.0013 [-0.0001, +0.0026] / +0.0002 [-0.0010, +0.0014] |

All six calibrated variants land at roughly **0.028-0.029 win and 0.059 podium Brier**, and every difference between them is inside its confidence interval (largest: +0.0017 win for V1-isotonic). The in-sample shortcut (V2) happens to give the same answer because the production models are only mildly overfit: their mean podium score on 2023-24 (0.258) is almost the same as the honest holdout's (0.256), against an actual podium rate of 0.150. In other words the overconfidence is **systematic (a level shift, consistent with class weighting), not overfitting**, which is why the provenance of the calibration data barely matters. V2 is still methodologically unsound and should not be used if a calibrator is ever shipped; V3 is the better design because it uses 209 held-out races instead of 46. Note that V3-Platt, like V1, still leaves the per-race sums above 1 / 3 (1.20 / 3.31), so a renormalisation step would still be needed.

This is evaluated for the real-grid condition only. As in 5.2, a calibrator fit on real-grid predictions does not transfer to the predicted-grid path.

## 6. Other findings made while auditing (for Parts 1A, 1C, 1D)

| # | finding | evidence | status |
|---|---|---|---|
| 1 | `results.csv` grid is NULL for all 20 rows of raceId 1167 (2025 Qatar GP); `prepare_df` makes it 0 | `analysis/cache/jolpica_2025_r23_results.json` vs the CSV | verified; data file not changed |
| 2 | `/whatif` and the lookups use features one race stale (entering the driver's previous race, not entering the next race) | `backend/main.py` `whatif_predict`, `lookups.compute_lookups` ("last value"); effect measured in 5.2 | verified; effect small |
| 3 | A note in the notebook says `qualifying.csv` has no 2025+ rows; it now has 479 (2025) and 413 (2026) | counts from the CSV | verified; the comment is stale |
| 4 | Production rounds `/whatif` probabilities to 4 decimals and clamps win to podium (ties between win and podium scores are common at the top, e.g. 0.9576 / 0.9576 for the Brazil pick) | `backend/main.py` | verified |
| 5 | No sprint results are used anywhere in the race model | feature list | verified |

## 7. Limits of this analysis

- 43 races: winner hit rate intervals are about ±14pp wide; differences smaller than that should not be read as real.
- Priors for the baselines are fit on 2010-2024 outcomes, so they are fair for 2025-26, but they know nothing of the 2026 rules either.
- The calibrators in 5.1-5.2 were fit on a *different* model (trained through 2022) than the one being evaluated (trained through 2024). Section 5.5 shows that swapping in an in-sample fit or a 10-season expanding-window fit changes the result by less than the noise, so this is not driving the conclusions. A calibrator for the production model itself has no held-out years left; the expanding-window design in 5.5 (V3) is the way to get one.
- Section 5.1-5.2 conclusions about "level with the baseline" mean *not distinguishable at this sample size*, not proven equal.
- Log loss uses clipped probabilities (1e-4); Brier is unaffected by clipping.
- Not examined: the quali model on its own terms beyond section 4.5, constructor-level effects, wet races, sprint weekends, and DNF modelling.

## 8. Carried forward to the next parts (scope additions from the product owner)

- **Part 1C:** test whether practice pace (FP2/FP3 long runs), sprint-qualifying results, or the previous race's grid improve the *pre-qualifying* grid prediction, using OpenF1 / FastF1 historical data. Motivation: section 4.5 and 5.2 show the predicted grid is the largest single source of error on the snapshot path. See `docs/stage1/00-scope.md`.
- **Part 1D:** a validation check that catches an all-NULL `grid` for a race (the 2025 Qatar GP defect, section 6 row 1). See `docs/stage1/00-scope.md`.

## 9. Reproduce

```
python analysis/01_pit_check.py        # point-in-time recomputation (about 10 s)
python analysis/02_backtest.py         # the replay + bootstrap (about 4 min); PATCH_QATAR_GRID=0 reproduces the unpatched numbers
python analysis/03_experiments.py      # normalisation, calibration, Plackett-Luce, fresh-feature hybrid (about 20 s)
python analysis/04_grid_diagnostics.py # predicted-grid accuracy
python analysis/05_report_tables.py    # per-bin n + intervals, winner-hit table
python analysis/06_calibration_provenance.py  # does the calibration data's provenance matter (section 5.5)
```

Outputs in `analysis/out/`: `pit_check.json`, `backtest_results.json`, `backtest_rows.csv` (every prediction), `backtest_sums_*.csv`, `backtest_dropped_no_history.csv`, `experiments_results.json`, and `reliability_ci.*`, `winner_hit_ci.*`, `calibration_provenance.json`, and `unpatched/` (the same results before the Qatar patch, for the sensitivity check). Bootstrap seeds are fixed. The scripts import `backend/main.py` and `backend/lookups.py` and load the committed model artifacts read-only.
