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

### 4.4 Reliability (10 equal-width bins, pooled)

Win probability: predicted mean vs observed frequency.

| bin | (a) n | (a) pred | (a) obs | (b) n | (b) pred | (b) obs |
|---|---|---|---|---|---|---|
| 0.0-0.1 | 680 | 0.008 | 0.001 | 679 | 0.007 | 0.006 |
| 0.1-0.2 | 34 | 0.143 | 0.029 | 28 | 0.148 | 0.107 |
| 0.2-0.3 | 34 | 0.247 | 0.029 | 24 | 0.240 | 0.125 |
| 0.3-0.4 | 20 | 0.355 | 0.000 | 17 | 0.337 | 0.118 |
| 0.4-0.5 | 21 | 0.450 | 0.000 | 14 | 0.447 | 0.071 |
| 0.5-0.6 | 9 | 0.570 | 0.000 | 24 | 0.537 | 0.208 |
| 0.6-0.7 | 14 | 0.660 | 0.214 | 17 | 0.643 | 0.059 |
| 0.7-0.8 | 23 | 0.760 | 0.261 | 18 | 0.753 | 0.333 |
| 0.8-0.9 | 29 | 0.863 | 0.414 | 28 | 0.838 | 0.286 |
| 0.9-1.0 | 33 | 0.938 | 0.576 | 43 | 0.940 | 0.233 |

Podium probability:

| bin | (a) n | (a) pred | (a) obs | (b) n | (b) pred | (b) obs |
|---|---|---|---|---|---|---|
| 0.0-0.1 | 560 | 0.019 | 0.004 | 557 | 0.018 | 0.011 |
| 0.1-0.2 | 43 | 0.146 | 0.000 | 46 | 0.145 | 0.109 |
| 0.2-0.3 | 28 | 0.253 | 0.071 | 19 | 0.253 | 0.000 |
| 0.3-0.4 | 18 | 0.338 | 0.222 | 20 | 0.344 | 0.150 |
| 0.4-0.5 | 21 | 0.446 | 0.143 | 16 | 0.456 | 0.250 |
| 0.5-0.6 | 18 | 0.556 | 0.111 | 26 | 0.549 | 0.231 |
| 0.6-0.7 | 40 | 0.655 | 0.250 | 30 | 0.648 | 0.400 |
| 0.7-0.8 | 40 | 0.746 | 0.375 | 42 | 0.754 | 0.429 |
| 0.8-0.9 | 50 | 0.853 | 0.500 | 47 | 0.849 | 0.447 |
| 0.9-1.0 | 79 | 0.941 | 0.835 | 89 | 0.945 | 0.607 |

Reading it: with n of 9-50 per upper bin each observed rate is itself noisy (a bin of 20 has a standard error of about 0.1), so single bins mean little. The pattern across bins does not: every bin above 0.1 sits well below its predicted value in both conditions, and (b) is worse than (a). The model is overconfident everywhere, consistent with the class-weighted training (`scale_pos_weight`) inflating scores.

### 4.5 How good is the predicted grid? (`analysis/04_grid_diagnostics.py`, 43 races)

Mean Spearman vs the real grid 0.74 (2025: 0.69, 2026: 0.80); pole-sitter named correctly in 7 of 43 races (16.3%); mean position error 3.2; top-3 grid overlap 1.58 of 3. This is the weakest link in the snapshot path.

## 5. Experiments (throwaway; nothing here is used by the app)

All on the same 43 races, intervals bootstrap-by-race (2,000 resamples). Difference columns are paired against the raw scores. "Cal" variants were fit on **2023-24 out-of-sample predictions (919 driver-races, 46 races) of throwaway XGBoost models trained only through 2022**, using the production hyperparameters, so no 2025-26 information touches any calibrator. The production artifacts were not used to fit anything.

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
- The calibrators were fit on a *different* model (trained through 2022) than the one being evaluated (trained through 2024); applying them to the production scores is an approximation. A calibrator fit on the production model's own out-of-sample predictions would need either held-out years (none are left) or the expanding-window approach in 5.3.
- Section 5.1-5.2 conclusions about "level with the baseline" mean *not distinguishable at this sample size*, not proven equal.
- Log loss uses clipped probabilities (1e-4); Brier is unaffected by clipping.
- Not examined: the quali model on its own terms beyond section 4.5, constructor-level effects, wet races, sprint weekends, and DNF modelling.

## 8. Reproduce

```
python analysis/01_pit_check.py        # point-in-time recomputation (about 10 s)
python analysis/02_backtest.py         # the replay + bootstrap (about 4 min); PATCH_QATAR_GRID=0 reproduces the unpatched numbers
python analysis/03_experiments.py      # normalisation, calibration, Plackett-Luce, fresh-feature hybrid (about 20 s)
python analysis/04_grid_diagnostics.py # predicted-grid accuracy
```

Outputs in `analysis/out/`: `pit_check.json`, `backtest_results.json`, `backtest_rows.csv` (every prediction), `backtest_sums_*.csv`, `backtest_dropped_no_history.csv`, `experiments_results.json`, and `unpatched/` (the same results before the Qatar patch, for the sensitivity check). Bootstrap seeds are fixed. The scripts import `backend/main.py` and `backend/lookups.py` and load the committed model artifacts read-only.
