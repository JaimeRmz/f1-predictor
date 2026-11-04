// Local-time formatting shared by Home and Race.
const tz = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "local time";
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pad = (n) => String(n).padStart(2, "0");

export { tz, dayTime, pad };
