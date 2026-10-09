import { readFile, readdir } from "node:fs/promises";
import { SourceTextModule } from "node:vm";
import { TICKET_CARD_HTML } from "../../dist/generated/ticket-card-html.js";
const html = await readFile(new URL("../../ui/dist/index.html", import.meta.url), "utf8");
const files = await readdir(new URL("../../ui/dist/", import.meta.url));
if (files.length !== 1 || files[0] !== "index.html" || html !== TICKET_CARD_HTML ||
    /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)/i.test(html) ||
    !html.includes("BRAND_INJECT") || !html.includes('id="root"')) throw new Error("ticket_card_output_invalid");
const scripts = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 1) throw new Error("ticket_card_script_count_invalid");
try { new SourceTextModule(scripts[0][1]); } catch { throw new Error("ticket_card_module_syntax_invalid"); } // Parse without linking or executing.
console.log(JSON.stringify({ ticketCardSelfContained: true, embeddedOutputMatched: true, scriptSyntaxValid: true }));
