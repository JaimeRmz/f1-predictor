"""Fit the noise of the rank-anchored draw to the model's REAL backtest errors (analysis/out/projected_draw_profile.json, finishers only).
key_i = rank_i + wobble_i + upset_i, finishing order = sort by key.
  wobble_i ~ N(0, s_b)           s_b: one value per predicted-rank bucket (everyday scatter)
  upset_i  ~ with prob pi_b: a one-sided jump of |N(0, S)| places: back for ranks 1-15 (a favourite or midfielder has a bad day) and
             for ranks 16+ (an also-ran can only climb)  (real front-runners miss by 9+ places in ~1 race in 6)
Targets (per rank bucket): median |error|, 75th and 90th percentile, share within 2 places, share 9+ places out; overall: a model-bottom-half
driver finishing in the top 5 (per driver 3.0%, at least one per race 25.6%). Writes analysis/out/projected_draw_fit.json"""
import json, os
import numpy as np
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = json.load(open(os.path.join(ROOT, "analysis/out/projected_draw_profile.json")))["finishers"]
B = [(1, 1), (2, 3), (4, 6), (7, 10), (11, 15), (16, 30)]
names = ["1", "2-3", "4-6", "7-10", "11-15", "16-30"]
# quantiles measured by analysis/proj/quant.py on the same rows (finishers, predicted-grid condition)
Q = dict(med=[2.0, 1.5, 2.0, 3.0, 3.0, 3.0], p75=[3, 4, 4, 6, 5, 6], p90=[16.6, 13, 8, 9, 7, 9], le2=[.67, .64, .56, .42, .42, .39], ge9=[.16, .14, .09, .13, .03, .15])
# real rates by bucket: win, podium, top 5 (a driver the model ranks 7th or lower NEVER won in 43 races)
REAL_BIAS = [4.02, 3.10, 0.50, 2.49, -1.00, -3.47]            # mean (actual - predicted rank) per bucket
REAL_WIN = [.233, .186 , .132, 0.0, 0.0, 0.0]; REAL_POD = [.674, .465, .388, .035, .019, .0]; REAL_T5 = [.837, .674, .682, .110, .056, .010]
BH_DRIVER, BH_RACE = REAL["bottom_half_in_top5_rate_per_driver"], REAL["races_with_a_bottom_half_driver_in_top5"]
N = 20
rank = np.arange(1, N + 1)
bucket = np.array([[i for i, (lo, hi) in enumerate(B) if lo <= r <= hi][0] for r in rank])
R = 30000
rng = np.random.default_rng(7)
Z1 = rng.standard_normal((R, N)); Z2 = rng.standard_normal((R, N)); U = rng.random((R, N))     # common random numbers

GROUP = np.where(rank <= 6, 0, np.where(rank <= 10, 1, np.where(rank <= 15, 2, 3)))     # upset groups: 1-6, 7-10, 11-15, 16+
CEIL = np.array([1.0, 2.0, 3.0, 4.0])
DIR = np.array([1.0, 1.0, 1.0, -1.0])[GROUP]                              # +1 = fall back, -1 = climb
SGN = np.where(DIR[None, :] == 0, np.sign(Z1), DIR[None, :])
def simulate(theta):
    s = np.abs(theta[:6]); pi = 1 / (1 + np.exp(-theta[6:10])); S = abs(theta[10])
    pib = pi[GROUP]
    key = rank[None, :] + s[bucket][None, :] * Z1 + (U < pib[None, :]) * SGN * S * np.abs(Z2)
    key = np.maximum(key, CEIL[GROUP][None, :] + 0.01 * rank[None, :])      # best finish seen in 43 real races: rank 7-10 -> 2nd, 11-15 -> 3rd, 16+ -> 4th
    fin = np.argsort(np.argsort(key, axis=1), axis=1) + 1
    return fin - rank[None, :], fin

def stats(err, fin):
    out = {}
    a = np.abs(err)
    for k in range(6):
        e = a[:, bucket == k].ravel()
        out[k] = dict(med=np.median(e), p75=np.quantile(e, .75), p90=np.quantile(e, .9), le2=(e <= 2).mean(), ge9=(e >= 9).mean(), mae=e.mean())
    bh = rank > N / 2
    top5 = fin[:, bh] <= 5
    for k in range(6):
        f = fin[:, bucket == k]
        out[k].update(bias=(f - rank[bucket == k][None, :]).mean(), win=(f == 1).mean(), pod=(f <= 3).mean(), t5=(f <= 5).mean())
    return out, top5.mean(), top5.any(axis=1).mean()

def loss(theta):
    err, fin = simulate(theta)
    st, bhd, bhr = stats(err, fin)
    l = 0.0
    for k in range(6):
        l += ((st[k]["med"] - Q["med"][k]) / 1.0) ** 2 + ((st[k]["p75"] - Q["p75"][k]) / 1.5) ** 2 + ((st[k]["p90"] - Q["p90"][k]) / 3.0) ** 2
        l += ((st[k]["le2"] - Q["le2"][k]) / 0.08) ** 2 + ((st[k]["ge9"] - Q["ge9"][k]) / 0.05) ** 2
    for k in range(6):
        tight = 0.25 if k >= 3 else 0.4                     # ranks 7+: real wins are zero and podiums rare, so be strict there
        l += ((st[k]["win"] - REAL_WIN[k]) / (0.04 * tight)) ** 2 + ((st[k]["pod"] - REAL_POD[k]) / (0.05 * tight)) ** 2 + ((st[k]["t5"] - REAL_T5[k]) / 0.06) ** 2
    for k in range(6):
        l += ((st[k]["bias"] - REAL_BIAS[k]) / 0.8) ** 2
    mp = fin.mean(axis=0)                                  # the average finishing position must never improve as the model rank gets worse
    l += (np.maximum(0, mp[:-1] - mp[1:]) ** 2).sum() / 0.05 ** 2
    l += ((bhd - BH_DRIVER) / 0.01) ** 2 + ((bhr - BH_RACE) / 0.05) ** 2
    return l

best = None
for start in ([1.5, 2, 2, 3, 2.5, 3, -0.5, -1.5, -2.5, -1.5, 8], [1.2, 1.5, 1.5, 2, 2, 2.5, -1, -1, -3, -2, 6], [2, 2.5, 2.5, 3.5, 3, 3.5, 0, -2, -2, -1, 10]):
    r = minimize(loss, np.array(start, float), method="Nelder-Mead", options=dict(maxiter=2500, xatol=1e-2, fatol=1e-2))
    if best is None or r.fun < best.fun:
        best = r
theta = best.x
err, fin = simulate(theta)
st, bhd, bhr = stats(err, fin)
s = np.abs(theta[:6]); pi = 1 / (1 + np.exp(-theta[6:10])); S = abs(theta[10])
print(f"wobble sd per bucket {np.round(s, 2).tolist()}  upset prob 1-6/7-10/11-15/16+ {np.round(pi, 3).tolist()}  upset size {S:.2f}   (loss {best.fun:.1f})")
print("(real/sim)")
print("bucket   med real/sim   p75 real/sim   p90 real/sim   within2 real/sim   9+ real/sim   MAE real/sim")
for k, n in enumerate(names):
    print(f"         bias {REAL_BIAS[k]:+.2f}/{st[k]['bias']:+.2f}  win {REAL_WIN[k]:.3f}/{st[k]['win']:.3f}  podium {REAL_POD[k]:.3f}/{st[k]['pod']:.3f}  top5 {REAL_T5[k]:.3f}/{st[k]['t5']:.3f}")
    print(f"{n:7}  {Q['med'][k]:4.1f} {st[k]['med']:4.1f}     {Q['p75'][k]:4.1f} {st[k]['p75']:4.1f}     {Q['p90'][k]:5.1f} {st[k]['p90']:5.1f}     {Q['le2'][k]:.2f} {st[k]['le2']:.2f}         {Q['ge9'][k]:.2f} {st[k]['ge9']:.2f}      {REAL['by_rank'][n]['mae']:.2f} {st[k]['mae']:.2f}")
print("mean finishing position by model rank (sim):", np.round(fin.mean(axis=0), 1).tolist())
print(f"bottom-half driver in top 5: per driver real {BH_DRIVER:.3f} sim {bhd:.3f}   at least one per race real {BH_RACE:.3f} sim {bhr:.3f}")
json.dump(dict(buckets=names, wobble_sd=[round(float(x), 3) for x in s], upset_prob=[round(float(x), 4) for x in pi], upset_sd=round(float(S), 3), N=N), open(os.path.join(ROOT, "analysis/out/projected_draw_fit.json"), "w"), indent=1)
