import pandas as pd
bt = pd.read_csv('analysis/out/backtest_rows.csv'); bt = bt[bt.cond == 'b_predicted_quali']
res = pd.read_csv('data/results.csv', na_values=['\\N']).merge(pd.read_csv('data/drivers.csv')[['driverId', 'driverRef']], on='driverId')
bt = bt.merge(res[['raceId', 'driverRef', 'position']], on=['raceId', 'driverRef'], how='left'); bt = bt[bt.position.notna()].copy()
bt['prank'] = bt.groupby('raceId').apply(lambda x: (-x.p_pod - x.p_win * 1e-6).rank(method='first')).reset_index(level=0, drop=True)
bt['act'] = bt.groupby('raceId').positionOrder.rank(method='first')
bt['err'] = bt.act - bt.prank
bt['b'] = pd.cut(bt.prank, [0, 1, 3, 6, 10, 15, 30], labels=['1', '2-3', '4-6', '7-10', '11-15', '16+'])
def f(e):
    return pd.Series({'n': len(e), 'med': e.abs().median(), 'p75': e.abs().quantile(.75), 'p90': e.abs().quantile(.9), 'le2': (e.abs() <= 2).mean(), 'le5': (e.abs() <= 5).mean(), 'ge9': (e.abs() >= 9).mean()})
print(bt.groupby('b', observed=True).err.apply(f).unstack().round(2))
print('all', f(bt.err).round(3).to_dict())
# how are the misses spread across races? (a few chaotic races or everywhere?)
per = bt.groupby('raceId').err.apply(lambda e: e.abs().mean())
print('per-race MAE quantiles', per.quantile([.1, .25, .5, .75, .9]).round(2).to_dict())
print()
g = bt.groupby('b', observed=True)
print('REAL by predicted-rank bucket: win rate, podium rate, top5 rate')
print(pd.DataFrame({'win': g.apply(lambda x: (x.act == 1).mean()), 'podium': g.apply(lambda x: (x.act <= 3).mean()), 'top5': g.apply(lambda x: (x.act <= 5).mean())}).round(3))
r = bt[bt.prank >= 7]
print('rank>=7 wins per race:', round((r.act == 1).sum() / bt.raceId.nunique(), 3), ' podium places per race:', round((r.act <= 3).sum() / bt.raceId.nunique(), 3))
m = bt[(bt.prank >= 7) & (bt.prank <= 10)]
print('REAL rank 7-10 finishes 17th or worse (finishers re-ranked):', round((m.act >= 17).mean(), 3), ' n', len(m))
print('REAL best actual finish by predicted-rank band (finishers re-ranked) and largest climb:')
for lo, hi in [(7, 10), (11, 15), (16, 30)]:
    m = bt[(bt.prank >= lo) & (bt.prank <= hi)]
    print(f'  rank {lo}-{hi}: best finish {int(m.act.min())}, 5 best finishes {sorted(m.act)[:5]}, largest climb {int((m.prank - m.act).max())}, climbs>=8: {(m.prank - m.act >= 8).mean():.3f}')
