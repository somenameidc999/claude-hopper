// Bun loads this via `preload` in bunfig.toml. Sets the test-wide env that
// silences hopper's user-facing output so test runs aren't polluted.
process.env.CLAUDE_HOPPER_QUIET = "1";
