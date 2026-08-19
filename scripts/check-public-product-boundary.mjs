import { readFileSync } from "node:fs";

const failures = [];
const home = readFileSync("public/index.html", "utf8");
const login = readFileSync("public/login.html", "utf8");

for (const phrase of [">AKARI login", ">AKARI team login", "AKARI House /"]) {
  if (home.includes(phrase)) failures.push(`ambiguous CRM public copy: ${phrase}`);
}
if (home.includes("<span>AKARI House<small>Illustrative workspace</small></span>"))
  failures.push("CRM preview is labelled as an AKARI House workspace");
if (/AKARI House is Customer 001/i.test(login))
  failures.push("CRM login exposes internal Customer 001 wording");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("CRM public product boundary check passed.");
