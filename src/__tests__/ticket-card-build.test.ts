import { describe, it, expect } from "vitest";
// @ts-expect-error Repository build step is JavaScript.
import { ticketCardInline } from "../../scripts/build/ticket-card-inline.mjs";
function fixture(code = 'console.log("ticket")') {
  return { "index.html": { type: "asset", source: '<script type="module" src="./card.js"></script><link rel="stylesheet" href="./card.css">' },
    "card.js": { type: "chunk", imports: [], dynamicImports: [], code },
    "card.css": { type: "asset", source: ".card{color:blue}" } };
}
describe("narrow ticket-card inliner", () => {
  it("inlines JS and CSS and emits exactly one HTML asset", () => {
    const bundle = fixture(); ticketCardInline().generateBundle({}, bundle);
    expect(Object.keys(bundle)).toEqual(["index.html"]);
    expect(bundle["index.html"].source).toBe('<script type="module">console.log("ticket")</script><style>.card{color:blue}</style>');
  });
  it("escapes script terminators and HTML comment openings", () => {
    const bundle = fixture('const s="</script><!--";'); ticketCardInline().generateBundle({}, bundle);
    expect(bundle["index.html"].source).toContain('const s="\\x3C/script>\\x3C!--";');
  });
  it("rejects unmatched output, remote dependencies, and additional chunks", () => {
    const bundle = fixture(); bundle["index.html"].source = '<script src="https://evil.example/card.js"></script>';
    expect(() => ticketCardInline().generateBundle({}, bundle)).toThrow();
    const extra = { ...fixture(), "extra.bin": { type: "asset", source: "x" } };
    expect(() => ticketCardInline().generateBundle({}, extra)).toThrow("ticket_card_unexpected_output");
    const unresolved = fixture(); unresolved["card.js"].imports = ["external.js"] as never;
    expect(() => ticketCardInline().generateBundle({}, unresolved)).toThrow();
  });
  it("supports Rolldown's already-inlined self dynamic-import metadata", () => {
    const bundle = fixture(); bundle["card.js"].dynamicImports = ["card.js"] as never;
    ticketCardInline().generateBundle({}, bundle); expect(Object.keys(bundle)).toEqual(["index.html"]);
  });
});
