import test from "node:test";

import { assertPackageNotices } from "../scripts/package-notices.mjs";

test("exact package pins, lock digest, and production bundle notices agree", async () => {
  await assertPackageNotices();
});
