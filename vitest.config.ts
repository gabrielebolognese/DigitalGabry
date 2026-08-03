import { defineConfig } from "vitest/config";

/* Separate from vite.config.ts so the test run does not build the React and
   Tailwind plugin chain it never uses.

   fileParallelism is off because the suite asserts performance budgets. Run
   alongside three other files, the seven day generation benchmark reported
   61ms and then 311ms while measuring 2.9ms with the machine to itself: the
   number was tracking how busy the box was rather than how fast the code is.
   A timing assertion that fails on contention is worse than no assertion,
   because the reflex becomes to loosen the budget rather than to look. The
   suite is small, so serial costs a few seconds and buys a reading that means
   something. */
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
