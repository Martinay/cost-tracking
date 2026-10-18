import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the pinned React runtime can render semantic markup", () => {
  expect(renderToStaticMarkup(createElement("main", null, "Ledger"))).toBe(
    "<main>Ledger</main>",
  );
});
