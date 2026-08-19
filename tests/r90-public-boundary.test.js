import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("CRM public surfaces clearly identify CRM by AKARI", () => {
  const home = read("public/index.html");
  const login = read("public/login.html");

  assert.match(home, /CRM by AKARI/);
  assert.doesNotMatch(home, />AKARI login</);
  assert.doesNotMatch(home, />AKARI team login</);
  assert.doesNotMatch(home, /AKARI House\s*\//);
  assert.doesNotMatch(home, /<span>AKARI House<small>Illustrative workspace<\/small><\/span>/);

  assert.match(login, /AKARI CRM|CRM by AKARI/);
  assert.doesNotMatch(login, /AKARI House is Customer 001/i);
});
