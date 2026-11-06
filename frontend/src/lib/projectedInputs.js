import { driverCode, teamIdOf, teamColor, rankRows } from "./homeModel.js";

/**
 * Turn the rows the page already fetches for an upcoming race (POST /whatif, predicted grid) into the generator's inputs.
 * grid   = [{ code, name, team, colour }] in predicted grid order (pole first)
 * scores = { [code]: { win, podium } } the rows' existing raw model scores, passed through untouched
 * order  = driver codes in the order of the Race page's "Full forecast" table (rankRows: podium score, ties by win score), the order the
 *          projected race plays out
 * A row without a finite podium score still appears in `grid`; the generator leaves it out of the race.
 */
export const inputsFromRows = (rows) => {
  const used = new Set();
  const list = [...rows]
    .sort((a, b) => (a.grid ?? 99) - (b.grid ?? 99) || (b.podium_probability ?? 0) - (a.podium_probability ?? 0))
    .map((r) => {
      let code = driverCode(r.driver_name);
      for (let k = 2; used.has(code); k++) code = `${code.slice(0, 2)}${k}`;
      used.add(code);
      const teamId = teamIdOf(r);
      return { code, name: r.driver_name, team: teamId || r.team, colour: teamColor(teamId).replace("#", ""), row: r };
    });
  const codeOfName = new Map(list.map((g) => [g.name, g.code]));
  return {
    order: rankRows(rows).map((r) => codeOfName.get(r.driver_name)),
    grid: list.map((g) => ({ code: g.code, name: g.name, team: g.team, colour: g.colour })),
    scores: Object.fromEntries(list.map((g) => [g.code, { win: g.row.win_probability ?? 0, podium: g.row.podium_probability }])),
  };
};
