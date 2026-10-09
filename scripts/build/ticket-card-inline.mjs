// Deliberately limited to this repository's single MCP ticket-card build.
// No glob patterns, external file reads, or additional dependency are required.
export function ticketCardInline() {
  return {
    name: "connectwise:ticket-card-inline",
    enforce: "post",
    generateBundle(_options, bundle) {
      const entry = bundle["index.html"];
      if (!entry || entry.type !== "asset" || typeof entry.source !== "string")
        throw new Error("ticket_card_html_required");
      let html = entry.source;
      let scripts = 0;
      for (const [name, output] of Object.entries(bundle)) {
        if (name === "index.html") continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (output.type === "chunk" && name.endsWith(".js")) {
          if (output.imports.length || output.dynamicImports.some(reference => reference !== name) || ++scripts !== 1)
            throw new Error("ticket_card_must_have_one_self_contained_script");
          const tag = new RegExp(`<script([^>]*?) src="(?:\\./)?${escaped}"([^>]*)></script>`);
          if (!tag.test(html)) throw new Error("ticket_card_script_reference_missing");
          const code = output.code.replace(/"?__VITE_PRELOAD__"?/g, "void 0")
            .replace(/<(\/script>|!--)/g, "\\x3C$1");
          html = html.replace(tag, (_match, before, after) => `<script${before}${after}>${code.trim()}</script>`);
        } else if (output.type === "asset" && name.endsWith(".css") && typeof output.source === "string") {
          const tag = new RegExp(`<link([^>]*?) href="(?:\\./)?${escaped}"([^>]*)>`);
          if (!tag.test(html)) throw new Error("ticket_card_stylesheet_reference_missing");
          const css = output.source.replace('@charset "UTF-8";', "");
          if (/<\/style/i.test(css)) throw new Error("ticket_card_unsafe_style_terminator");
          html = html.replace(tag, () => `<style>${css.trim()}</style>`);
        } else throw new Error("ticket_card_unexpected_output");
        delete bundle[name];
      }
      if (scripts !== 1 || /<script\b[^>]*\bsrc\s*=/i.test(html) ||
          /<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(html))
        throw new Error("ticket_card_external_dependency");
      entry.source = html;
    },
  };
}
