#!/usr/bin/env node
// PreToolUse guard for the branch policy in CLAUDE.md.
//
// `main` is wired to Vercel production auto-deploy (f1predictor.app), so any
// commit that lands on main ships immediately. This turns commands that would
// write to main into a confirmation prompt instead of letting them run silently.
// It never denies — it only escalates to "ask".

const { execFileSync } = require("child_process");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  let cwd = process.cwd();
  try {
    const input = JSON.parse(raw);
    cmd = (input.tool_input && input.tool_input.command) || "";
    if (input.cwd) cwd = input.cwd;
  } catch {
    process.exit(0); // unparseable input: stay out of the way
  }

  if (!/\bgit\b/.test(cmd)) process.exit(0);

  const reason = classify(cmd, currentBranch(cwd));
  if (!reason) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `${reason}\n\nmain auto-deploys to production (f1predictor.app). Per CLAUDE.md, merging to main needs an explicit go-ahead from Jaime — approve only if he has said he is ready to ship.`,
      },
    })
  );
});

function currentBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function classify(cmd, branch) {
  const onMain = branch === "main";
  // A refspec naming main: "origin main", "HEAD:main", "main:main", ":main".
  const targetsMain = /(^|[\s:])main(\s|$)/.test(cmd);
  const forced = /(--force\b|--force-with-lease\b|(^|\s)-[a-zA-Z]*f(\s|$))/.test(cmd);

  if (/\bgit\s+push\b/.test(cmd)) {
    // A bare `git push` on main pushes main; an explicit main refspec always does.
    const bare = !/\bgit\s+push\b[^&|;]*\s\S+\s+\S+/.test(cmd);
    if (targetsMain || (bare && onMain)) {
      return forced
        ? "This force-pushes to main."
        : "This pushes to main, which publishes to production.";
    }
    return null;
  }

  if (/\bgit\s+merge\b/.test(cmd) && onMain) {
    return "This merges into main while main is checked out.";
  }

  if (/\bgit\s+commit\b/.test(cmd) && onMain) {
    return "This commits directly onto main. The policy is to branch first.";
  }

  // Moving the main ref without a merge: `git branch -f main`, `git reset --hard` on main.
  if (/\bgit\s+branch\b/.test(cmd) && forced && targetsMain) {
    return "This force-moves the main branch ref.";
  }
  if (/\bgit\s+reset\b.*--hard/.test(cmd) && onMain) {
    return "This hard-resets main.";
  }

  return null;
}
