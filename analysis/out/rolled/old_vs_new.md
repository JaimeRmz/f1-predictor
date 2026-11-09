# Predicted-grid backtest, before and after the roll-forward fix

Same 43 races (2025 + 2026 R1-R19); only the code differs. Winner-pick rows use the Wilson 95% interval the site shows; the bootstrap-by-race 95% interval is in brackets for the model rows.

## Winner picked (hits / 43)

| method | before | after |
|---|---|---|
| **Before qualifying (predicted grid)** | | |
| Model | 9/43 (21%), 11-35% | 14/43 (33%), 20-47% |
| Pick the points leader | 12/43 (28%), 17-43% | 12/43 (28%), 17-43% |
| Pick the best team's lead driver | 13/43 (30%), 19-45% | 13/43 (30%), 19-45% |
| Pick the predicted pole sitter | 8/43 (19%), 10-33% | 12/43 (28%), 17-43% |
| **After qualifying (real grid)** | | |
| Model | 26/43 (60%), 46-74% | 26/43 (60%), 46-74% |
| Pick the points leader | 12/43 (28%), 17-43% | 12/43 (28%), 17-43% |
| Pick the best team's lead driver | 13/43 (30%), 19-45% | 13/43 (30%), 19-45% |
| Pick the predicted pole sitter | 29/43 (67%), 53-80% | 29/43 (67%), 53-80% |

## Model quality, predicted-grid path (bootstrap-by-race 95% interval)

| metric | before | after | difference |
|---|---|---|---|
| winner picked | 0.209 [0.093, 0.326] | 0.326 [0.186, 0.465] | 0.116 |
| top-3 overlap (of 3) | 1.60 [1.40, 1.81] | 1.60 [1.40, 1.81] | 0.00 |
| Brier, win (lower is better) | 0.0887 [0.0794, 0.0980] | 0.0840 [0.0747, 0.0935] | -0.0047 |
| Brier, podium | 0.1133 [0.1020, 0.1253] | 0.1114 [0.1007, 0.1224] | -0.0019 |
| rank correlation of the order | 0.585 [0.520, 0.644] | 0.589 [0.525, 0.648] | 0.004 |
